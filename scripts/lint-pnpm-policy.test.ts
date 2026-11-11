import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./lint-pnpm-policy.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lint-pnpm-policy-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): void => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

const VALID_WORKSPACE = [
  "minimumReleaseAge: 10080",
  "trustPolicy: no-downgrade",
  "onlyBuiltDependencies: []",
  "blockExoticSubdeps: true",
  "",
].join("\n");

describe("run", () => {
  it("exits 0 for a valid repository", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const { output, exitCode } = run([root]);
    expect(exitCode).toBe(0);
    expect(output).toContain("no violations found");
  });

  it("exits 1 and prints file:line:col for a violation", () => {
    write(
      "pnpm-workspace.yaml",
      `${VALID_WORKSPACE}${"minimumReleaseAgeExclude"}:\n  - x\n`,
    );
    const { output, exitCode } = run([root]);
    expect(exitCode).toBe(1);
    expect(output).toContain("pnpm-workspace.yaml:5:1:");
    expect(output).toContain("1 violation(s) found");
  });

  it("exits 1 for a forbidden option in a script", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const flag = ["--trust-policy", "exclude"].join("-");
    write("package.json", JSON.stringify({ scripts: { install: flag } }));
    const { output, exitCode } = run([root]);
    expect(exitCode).toBe(1);
    expect(output).toContain(flag);
  });
});
