import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run } from "./check-mutation-findings.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "check-mutation-findings-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): void => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
};

const writeReport = (report: unknown): void =>
  write(".mutator/report/mutation.json", JSON.stringify(report));

const git = (...args: string[]): void => {
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: root, stdio: "ignore" },
  );
};

describe("run", () => {
  it("exits 1 when a test stopped detecting a mutant", () => {
    writeReport({
      findings: [
        {
          kind: "detectionRegression",
          key: "k1",
          previousKillers: ["src/core/a.test.ts#a"],
        },
      ],
      files: {},
    });
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toMatch(/^::error title=テストが弱くなった::/);
  });

  it("exits 0 when nothing got weaker", () => {
    writeReport({ comparison: "available", findings: [], files: {} });
    expect(run([], root)).toEqual({
      output: "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件\n",
      exitCode: 0,
    });
  });

  it("exits 1 when there is no report", () => {
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toContain("ミューテーションテストの結果が無い");
  });

  it("warns about mutator settings changed since the base ref", () => {
    writeReport({ comparison: "available", findings: [], files: {} });
    write("mutator.config.json", "{}\n");
    git("init", "--quiet", "--initial-branch=main");
    git("add", "mutator.config.json");
    git("commit", "--quiet", "-m", "base");
    git("switch", "--quiet", "-c", "change");
    write("mutator.config.json", '{"include":[]}\n');
    write("src/core/a.ts", "export const a = 1;\n");
    git("add", "mutator.config.json", "src/core/a.ts");
    git("commit", "--quiet", "-m", "change");
    const { output, exitCode } = run(["main"], root);
    expect(exitCode).toBe(0);
    expect(output.split("\n")[0]).toMatch(
      /^::warning file=mutator\.config\.json,title=ミューテーションテストの設定が変わった::/,
    );
    expect(output).not.toContain("src/core/a.ts");
  });
});
