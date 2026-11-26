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
      output: "mutation:diffの結果: 通過。エラー0件、警告0件\n",
      exitCode: 0,
    });
    expect(run(["--no-summary"], root)).toEqual({ output: "\n", exitCode: 0 });
  });

  it("exits 1 when there is no report", () => {
    const { output, exitCode } = run([], root);
    expect(exitCode).toBe(1);
    expect(output).toBe(
      "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にpnpm mutation:diffを実行してください。\nmutation:diffの結果: 失敗。エラー1件（「ミューテーションテストの結果が無い」1件）、警告0件\n",
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
    expect(output.split("\n")[0]).toBe(
      "::error title=ミューテーションテストの結果の形が違う::.mutator/report/mutation.jsonは想定したmutator 0.4のレポートではありません: schemaVersionがありません。このスクリプトは2だけを読みます。",
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
      /^::error title=基準のrefと比べられない::origin\/missingとの差分を取れません。/,
    );
    expect(output).toContain("origin/missing");
    expect(output.trimEnd().split("\n")).toHaveLength(2);
  });

  it("reads skipped tests and unrun mutants from mutator's output", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    write(
      "mutator.txt",
      "warning: src/a.test.ts:3 skips a test in the change, so it checks nothing: a skipped test\nKilled 2 · Pending 1\n",
    );
    const { output, exitCode } = run(
      ["--mutator-output", join(root, "mutator.txt")],
      root,
    );
    expect(exitCode).toBe(1);
    expect(output).toMatch(
      /^::warning file=src\/a\.test\.ts,line=3,title=飛ばしたテスト::/,
    );
    expect(output).toContain(
      "title=変更の範囲のミュータントが実行されなかった",
    );
    expect(output.trimEnd().split("\n").at(-1)).toBe(
      "mutation:diffの結果: 失敗。エラー1件（「変更の範囲のミュータントが実行されなかった」1件）、警告1件（「飛ばしたテスト」1件）",
    );
  });

  it("warns about uncommitted and untracked setting changes", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    write("mutator.config.json", "{}\n");
    write(".gitignore", ".mutator/\n");
    git("init", "--quiet", "--initial-branch=main");
    git("add", "mutator.config.json", ".gitignore");
    git("commit", "--quiet", "-m", "base");
    write("mutator.config.json", '{"include":[]}\n');
    write("vitest.config.ts", "export default {};\n");
    const { output, exitCode } = run(["main"], root);
    expect(exitCode).toBe(0);
    expect(output).toContain(
      "::warning file=mutator.config.json,title=ミューテーションテストの設定が変わった::",
    );
    expect(output).toContain(
      "::warning file=vitest.config.ts,title=テストの設定や準備ファイルが変わった::",
    );
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

  it("warns about a renamed settings file under its old name too", () => {
    writeReport({
      schemaVersion: "2",
      comparison: "available",
      findings: [],
      files: {},
    });
    write("mutator.config.json", '{"include":["src/**/*.ts"]}\n');
    git("init", "--quiet", "--initial-branch=main");
    git("add", "mutator.config.json");
    git("commit", "--quiet", "-m", "base");
    git("switch", "--quiet", "-c", "change");
    git("mv", "mutator.config.json", "mutator-settings.json");
    git("commit", "--quiet", "-m", "rename");
    const { output } = run(["main", "--no-summary"], root);
    expect(output).toContain(
      "::warning file=mutator.config.json,title=ミューテーションテストの設定が変わった::",
    );
  });
});
