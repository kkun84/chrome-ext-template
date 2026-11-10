import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./lint-ja-space.ts";

const SP = "\u0020";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ja-space-cli-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("run", () => {
  it("reports violations and exits 1", () => {
    const file = join(root, "a.md");
    writeFileSync(file, `日本語${SP}URL\n`);
    const { output, exitCode } = run([file]);
    expect(exitCode).toBe(1);
    expect(output).toContain("a.md:1:4:");
    expect(output).toContain("1 violation(s) found");
  });

  it("exits 0 when there is nothing to fix", () => {
    const file = join(root, "clean.md");
    writeFileSync(file, "日本語URL\n");
    const { output, exitCode } = run([file]);
    expect(exitCode).toBe(0);
    expect(output).toContain("no violations found");
  });

  it("applies fixes in place with --fix", () => {
    const file = join(root, "b.md");
    writeFileSync(file, `日本語${SP}URL\n`);
    const { output, exitCode } = run(["--fix", file]);
    expect(exitCode).toBe(0);
    expect(output).toContain("fixed 1 violation(s) in 1 file(s)");
    expect(readFileSync(file, "utf8")).toBe("日本語URL\n");
  });
});
