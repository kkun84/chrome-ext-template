import { describe, expect, it } from "vitest";
import { detectJaSpace, fixJaSpace, modeForExtension } from "./ja-space.ts";

/**
 * Test inputs use the `\u0020` escape for the offending space so this file
 * itself passes `scripts/lint-ja-space.ts` (the source has no literal
 * Japanese-space-ASCII sequence).
 */
const SP = "\u0020";

describe("detectJaSpace", () => {
  it("flags Japanese then ASCII (jp-to-ascii)", () => {
    const [violation] = detectJaSpace(`日本語${SP}URL`, { mode: "plain" });
    expect(violation?.direction).toBe("jp-to-ascii");
    expect(violation?.index).toBe(3);
  });

  it("flags ASCII then Japanese (ascii-to-jp)", () => {
    const [violation] = detectJaSpace(`URL${SP}の`, { mode: "plain" });
    expect(violation?.direction).toBe("ascii-to-jp");
    expect(violation?.index).toBe(3);
  });

  it("flags a number followed by Japanese (`7\u0020日`)", () => {
    const violations = detectJaSpace(`7${SP}日`, { mode: "plain" });
    expect(violations).toHaveLength(1);
  });

  it("flags the prolonged sound mark before ASCII", () => {
    const [violation] = detectJaSpace(`サーバー${SP}URL`, { mode: "plain" });
    expect(violation?.direction).toBe("jp-to-ascii");
  });

  it("does not flag text without a forbidden space", () => {
    expect(detectJaSpace("日本語URL", { mode: "plain" })).toHaveLength(0);
  });

  it("reports 1-based line and column", () => {
    const [violation] = detectJaSpace(`line\n日本語${SP}URL`, {
      mode: "plain",
    });
    expect(violation?.line).toBe(2);
    expect(violation?.column).toBe(4);
  });
});

describe("markdown masking", () => {
  it("flags a space between Japanese and an inline code span", () => {
    expect(detectJaSpace(`の${SP}\`tsc\``, { mode: "markdown" })).toHaveLength(
      1,
    );
    expect(detectJaSpace(`\`tsc\`${SP}の`, { mode: "markdown" })).toHaveLength(
      1,
    );
  });

  it("leaves the contents of fenced code blocks untouched", () => {
    const input = "```\n日本語\u0020URL\n```\n";
    expect(detectJaSpace(input, { mode: "markdown" })).toHaveLength(0);
  });

  it("leaves the contents of inline code spans untouched", () => {
    expect(
      detectJaSpace("`日本語\u0020URL`", { mode: "markdown" }),
    ).toHaveLength(0);
  });

  it("leaves URLs untouched", () => {
    expect(
      detectJaSpace("https://example.com/日本語 URL", { mode: "markdown" }),
    ).toHaveLength(0);
  });

  it("allows a space after a link destination", () => {
    expect(
      detectJaSpace("[Nix](https://nixos.org/) は", { mode: "markdown" }),
    ).toHaveLength(0);
  });

  it("allows a space after a reference link", () => {
    expect(detectJaSpace("[text][ref] の", { mode: "markdown" })).toHaveLength(
      0,
    );
  });

  it("allows a space after an issue reference", () => {
    expect(detectJaSpace("#5 をマージ", { mode: "markdown" })).toHaveLength(0);
  });

  it("does not treat an ATX heading as the #123 exception", () => {
    // `# 見出し` has no digits, so the issue-reference allowance must not fire.
    // It also must not be flagged, because `#` is not an ASCII word.
    expect(detectJaSpace("# 見出し", { mode: "markdown" })).toHaveLength(0);
    // A heading that really does mix text is still flagged.
    expect(detectJaSpace("# WXT\u0020の", { mode: "markdown" })).toHaveLength(
      1,
    );
  });

  it("skips YAML front matter", () => {
    const input = "---\ntitle: 日本語\u0020URL\n---\n本文\n";
    expect(detectJaSpace(input, { mode: "markdown" })).toHaveLength(0);
  });

  it("does not flag an ordered list marker", () => {
    expect(detectJaSpace("1.\u0020日本語", { mode: "markdown" })).toHaveLength(
      0,
    );
  });
});

describe("typescript masking", () => {
  it("checks line comments", () => {
    expect(
      detectJaSpace("// 日本語\u0020URL", { mode: "typescript" }),
    ).toHaveLength(1);
  });

  it("checks block comments", () => {
    expect(
      detectJaSpace("/* 日本語\u0020URL */", { mode: "typescript" }),
    ).toHaveLength(1);
  });

  it("checks string literals", () => {
    expect(
      detectJaSpace('const s = "日本語\u0020URL";', { mode: "typescript" }),
    ).toHaveLength(1);
  });

  it("ignores identifiers", () => {
    expect(
      detectJaSpace("const\u0020日本語 = 1;", { mode: "typescript" }),
    ).toHaveLength(0);
  });
});

describe("tsx masking", () => {
  it("checks JSX text children", () => {
    expect(
      detectJaSpace("<p>日本語\u0020URL</p>", { mode: "tsx" }),
    ).toHaveLength(1);
  });

  it("fixes JSX text children", () => {
    expect(fixJaSpace("<p>日本語\u0020URL</p>", { mode: "tsx" }).fixed).toBe(
      "<p>日本語URL</p>",
    );
  });

  it("still checks comments and string literals", () => {
    expect(detectJaSpace("// 日本語\u0020URL", { mode: "tsx" })).toHaveLength(
      1,
    );
    expect(
      detectJaSpace('const s = "日本語\u0020URL";', { mode: "tsx" }),
    ).toHaveLength(1);
  });

  it("checks JSX text inside a nested expression", () => {
    expect(
      detectJaSpace("<div>{ok ? <span>日本語\u0020URL</span> : null}</div>", {
        mode: "tsx",
      }),
    ).toHaveLength(1);
  });

  it("does not flag identifiers in JSX expressions or generics", () => {
    expect(
      detectJaSpace("const x = <p>{value}</p>;", { mode: "tsx" }),
    ).toHaveLength(0);
    expect(
      detectJaSpace("const [s] = useState<string>();", { mode: "tsx" }),
    ).toHaveLength(0);
  });

  it("keeps string-literal attribute handling", () => {
    expect(
      detectJaSpace('<p title="日本語\u0020URL">x</p>', { mode: "tsx" }),
    ).toHaveLength(1);
  });

  it("does not scan JSX text in typescript mode", () => {
    expect(
      detectJaSpace("<p>日本語\u0020URL</p>", { mode: "typescript" }),
    ).toHaveLength(0);
  });
});

describe("html masking", () => {
  it("checks text nodes", () => {
    expect(
      detectJaSpace("<h1>保存した\u0020URL</h1>", { mode: "html" }),
    ).toHaveLength(1);
  });

  it("checks quoted attribute values", () => {
    expect(
      detectJaSpace('<a title="日本語\u0020URL">x</a>', { mode: "html" }),
    ).toHaveLength(1);
  });

  it("does not flag text inside a comment containing an inner `>`", () => {
    expect(
      detectJaSpace("<!-- x > 日本語\u0020URL -->", { mode: "html" }),
    ).toHaveLength(0);
  });

  it("leaves a comment unchanged but fixes text outside it", () => {
    const input = `<!-- x > 日本語${SP}URL --><p>日本語${SP}URL</p>`;
    expect(fixJaSpace(input, { mode: "html" }).fixed).toBe(
      `<!-- x > 日本語${SP}URL --><p>日本語URL</p>`,
    );
  });
});

describe("fixJaSpace", () => {
  it("removes only the violating space", () => {
    expect(fixJaSpace(`日本語${SP}URL`, { mode: "plain" }).fixed).toBe(
      "日本語URL",
    );
  });

  it("removes a space after the prolonged sound mark", () => {
    expect(fixJaSpace(`サーバー${SP}URL`, { mode: "plain" }).fixed).toBe(
      "サーバーURL",
    );
  });

  it("is idempotent", () => {
    const once = fixJaSpace(`日本語${SP}URL${SP}と${SP}WXT`, {
      mode: "plain",
    }).fixed;
    const twice = fixJaSpace(once, { mode: "plain" }).fixed;
    expect(twice).toBe(once);
  });

  it("returns the original string when there is nothing to fix", () => {
    const input = "日本語URL";
    const result = fixJaSpace(input, { mode: "plain" });
    expect(result.fixed).toBe(input);
    expect(result.violations).toHaveLength(0);
  });
});

describe("modeForExtension", () => {
  it("maps known extensions and rejects unknown ones", () => {
    expect(modeForExtension(".md")).toBe("markdown");
    expect(modeForExtension(".ts")).toBe("typescript");
    expect(modeForExtension(".tsx")).toBe("tsx");
    expect(modeForExtension(".html")).toBe("html");
    expect(modeForExtension(".txt")).toBeNull();
  });
});
