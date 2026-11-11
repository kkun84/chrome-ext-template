import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./lint-no-suppress.ts";
import { suppressionDirectives } from "./no-suppress.ts";

const BIOME = suppressionDirectives()[0] ?? "";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-no-suppress-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): string => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
};

describe("run", () => {
  it("exits 1 and reports the directive", () => {
    const file = write("a.ts", `// ${BIOME} lint: reason\n`);
    const { output, exitCode } = run([file]);
    expect(exitCode).toBe(1);
    expect(output).toContain("a.ts:1:1:");
    expect(output).toContain(BIOME);
    expect(output).toContain("1 violation(s) found");
  });

  it("exits 0 for a clean file", () => {
    const file = write("clean.ts", "export const x = 1;\n");
    const { output, exitCode } = run([file]);
    expect(exitCode).toBe(0);
    expect(output).toContain("no violations found");
  });

  it("ignores unsupported extensions", () => {
    const file = write("notes.md", `\`${BIOME}\` in prose\n`);
    const { exitCode } = run([file]);
    expect(exitCode).toBe(0);
  });

  it("scans a directory recursively", () => {
    write("src/a.ts", `// ${BIOME}\n`);
    write("src/b.ts", "const y = 2;\n");
    const { output, exitCode } = run([root]);
    expect(exitCode).toBe(1);
    expect(output).toContain("1 violation(s) found");
  });
});
