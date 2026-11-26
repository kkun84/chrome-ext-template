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
      schemaVersion: "2",
      comparison: "available",
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
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    expect(run([], root)).toEqual({
      output:
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件\n",
      exitCode: 0,
    });
  });

  it("exits 1 when there is no report", () => {
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toBe(
      "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にpnpm mutation:diffを実行してください。\n",
    );
  });

  it("exits 1 with the parse error when the report is not JSON", () => {
    write(".mutator/report/mutation.json", "{");
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toMatch(
      /^::error title=ミューテーションテストの結果を読めない::\.mutator\/report\/mutation\.jsonがJSONとして読めません: /,
    );
  });

  it("exits 1 when the report has another shape", () => {
    writeReport({ findings: [], files: {} });
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toBe(
      "::error title=ミューテーションテストの結果の形が違う::.mutator/report/mutation.jsonは想定したmutator 0.4のレポートではありません: schemaVersionがありません。このスクリプトは2だけを読みます。\n",
    );
  });

  it("exits 1 with git's message when the base ref does not exist", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    git("init", "--quiet", "--initial-branch=main");
    const { output, exitCode } = run(["origin/missing"], root);
    expect(exitCode).toBe(1);
    expect(output).toMatch(
      /^::error title=基準のrefと比べられない::origin\/missing\.\.\.HEADの差分を取れません。/,
    );
    expect(output).toContain("origin/missing");
    expect(output.trimEnd().split("\n")).toHaveLength(1);
  });

  it("fails on a regression found only by comparing with the baseline's report", () => {
    const mutant = (status: string) => ({
      id: "m",
      mutatorName: "BooleanLiteral",
      replacement: "true",
      location: { start: { line: 2, column: 1 } },
      status,
      killedBy: [],
      coveredBy: [],
    });
    const reportWith = (status: string) => ({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: { "src/core/a.ts": { source: "code", mutants: [mutant(status)] } },
    });
    writeReport(reportWith("NoCoverage"));
    write("base.json", JSON.stringify(reportWith("Timeout")));
    const { output, exitCode } = run(
      ["--base-report", join(root, "base.json")],
      root,
    );
    expect(exitCode).toBe(1);
    expect(output).toMatch(
      /^::error file=src\/core\/a\.ts,line=2,title=テストが弱くなった::/,
    );
  });

  it("exits 1 when the baseline's report cannot be read", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    const { output, exitCode } = run(
      ["--base-report", join(root, "missing.json")],
      root,
    );
    expect(exitCode).toBe(1);
    expect(output).toContain("基準のレポート");
  });

  it("warns about mutator settings changed since the base ref", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
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
