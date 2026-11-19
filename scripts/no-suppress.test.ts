import { describe, expect, it } from "vitest";
import {
  findSuppressions,
  isSupportedSuppressionFile,
  suppressionDirectives,
} from "./no-suppress.ts";

const directive = (index: number): string =>
  suppressionDirectives()[index] ?? "";

const BIOME = directive(0);
const TS_EXPECT = directive(1);
const TS_IGNORE = directive(2);
const TS_NOCHECK = directive(3);
const ESLINT = directive(4);
const FALLOW = directive(5);
const MUTATOR = directive(6);
const STRYKER = directive(7);

describe("suppressionDirectives", () => {
  it("builds all eight directives", () => {
    expect(suppressionDirectives()).toHaveLength(8);
    expect(BIOME).toBe("biome" + "-" + "ignore");
    expect(TS_EXPECT).toBe("@ts" + "-" + "expect" + "-" + "error");
  });
});

describe("findSuppressions in TypeScript", () => {
  it("flags a line comment", () => {
    const findings = findSuppressions(`// ${BIOME} lint: reason\n`, ".ts");
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toContain(BIOME);
    expect(findings[0]?.line).toBe(1);
  });

  it("passes without a directive", () => {
    expect(findSuppressions("const x = 1;\n", ".ts")).toHaveLength(0);
  });

  it("flags each directive used as a comment", () => {
    const inputs = [
      `// ${TS_EXPECT}\n`,
      `// ${TS_IGNORE}\n`,
      `// ${TS_NOCHECK}\n`,
      `// ${ESLINT}-next-line\n`,
      `// ${FALLOW}-next-line\n`,
      `// ${MUTATOR}-next-line: reason\n`,
      `// ${MUTATOR}-line\n`,
      `/* ${MUTATOR} */\n`,
      `// ${STRYKER} next-line all\n`,
    ];
    for (const input of inputs) {
      expect(findSuppressions(input, ".ts")).toHaveLength(1);
    }
  });

  it("flags a block comment", () => {
    expect(findSuppressions(`/* ${BIOME}-all */\n`, ".ts")).toHaveLength(1);
  });

  it("does not flag a string literal", () => {
    const input = `const s = "// ${BIOME} lint";\n`;
    expect(findSuppressions(input, ".ts")).toHaveLength(0);
  });

  it("does not flag Markdown prose naming a directive", () => {
    const input = `Use \`${BIOME}\` in prose.\n`;
    expect(findSuppressions(input, ".md")).toHaveLength(0);
  });
});

describe("findSuppressions in other syntaxes", () => {
  it("flags YAML and shell hash comments", () => {
    expect(findSuppressions(`# ${FALLOW}-next-line\n`, ".yml")).toHaveLength(1);
    expect(findSuppressions(`# ${BIOME}\n`, ".sh")).toHaveLength(1);
  });

  it("does not treat a shebang as a suppression", () => {
    expect(findSuppressions("#!/usr/bin/env bash\n", ".sh")).toHaveLength(0);
  });

  it("flags HTML comments", () => {
    expect(findSuppressions(`<!-- ${BIOME} -->\n`, ".html")).toHaveLength(1);
  });

  it("flags CSS block comments", () => {
    expect(findSuppressions(`/* ${ESLINT} */\n`, ".css")).toHaveLength(1);
  });
});

describe("isSupportedSuppressionFile", () => {
  it("accepts source and config, rejects markdown and json", () => {
    expect(isSupportedSuppressionFile("a.ts")).toBe(true);
    expect(isSupportedSuppressionFile("a.yml")).toBe(true);
    expect(isSupportedSuppressionFile("a.md")).toBe(false);
    expect(isSupportedSuppressionFile("a.json")).toBe(false);
  });
});
