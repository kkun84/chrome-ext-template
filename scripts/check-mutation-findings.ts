#!/usr/bin/env node
/**
 * CLI shell for the mutation findings review.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/check-mutation-findings.ts [base-ref] [--watch <file>]...
 *
 * Reads `.mutator/report/mutation.json` from the last mutator run and prints
 * GitHub Actions annotations: an error for each mutant the tests detected
 * before and no longer detect, a warning for each new test that detects
 * nothing and for each mutant no test detects. With a base ref (e.g.
 * `origin/main`) it also warns about changed `mutator.config.*` /
 * `mutator.accepted.json`, `vitest.config.*` and each `--watch` file (the
 * Vitest setup files) since that ref. Exits 1 when the tests got weaker,
 * when mutator had no baseline to compare with, or when the report or the ref
 * cannot be read. `scripts/mutation-diff.sh` makes the baseline and runs this.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeReport,
  failure,
  type Review,
  reviewFindings,
  reviewSettingChanges,
} from "./mutation-findings.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Where mutator's `json` reporter writes by default. */
const REPORT_PATH = ".mutator/report/mutation.json";

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const reviewReport = (root: string): Review => {
  let text: string;
  try {
    text = readFileSync(join(root, REPORT_PATH), "utf8");
  } catch (error) {
    return isMissing(error)
      ? failure(
          "ミューテーションテストの結果が無い",
          `${REPORT_PATH}がありません。先にpnpm mutation:diffを実行してください。`,
        )
      : failure(
          "ミューテーションテストの結果を読めない",
          `${REPORT_PATH}を読めません: ${reasonOf(error)}`,
        );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return failure(
      "ミューテーションテストの結果を読めない",
      `${REPORT_PATH}がJSONとして読めません: ${reasonOf(error)}`,
    );
  }
  const decoded = decodeReport(value);
  return "problem" in decoded
    ? failure(
        "ミューテーションテストの結果の形が違う",
        `${REPORT_PATH}は想定したmutator 0.4のレポートではありません: ${decoded.problem}`,
      )
    : reviewFindings(decoded.report);
};

const changedFiles = (
  root: string,
  base: string,
): { readonly files: readonly string[] } | { readonly problem: string } => {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", `${base}...HEAD`],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { files: output.split("\n").filter((file) => file.length > 0) };
  } catch (error) {
    const stderr =
      error instanceof Error && "stderr" in error ? String(error.stderr) : "";
    return { problem: stderr.trim() || reasonOf(error) };
  }
};

/** Run the review for `args` in `root` and return the output and exit code. */
export const run = (
  args: readonly string[],
  root: string = REPO_ROOT,
): { output: string; exitCode: number } => {
  const watched = args.flatMap((arg, index) =>
    args[index - 1] === "--watch" ? [arg] : [],
  );
  const base = args.find(
    (arg, index) => !arg.startsWith("--") && args[index - 1] !== "--watch",
  );
  const changed = base === undefined ? { files: [] } : changedFiles(root, base);
  const review =
    "problem" in changed
      ? failure(
          "基準のrefと比べられない",
          `${base}...HEADの差分を取れません。refの名前と、履歴を取得しているか（CIではfetch-depth: 0）を確かめてください: ${changed.problem}`,
        )
      : reviewReport(root);
  const settings =
    "problem" in changed ? [] : reviewSettingChanges(changed.files, watched);
  return {
    output: `${[...settings, ...review.lines].join("\n")}\n`,
    exitCode: review.exitCode,
  };
};

const main = (): void => {
  const { output, exitCode } = run(process.argv.slice(2));
  process.stdout.write(output);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

if (import.meta.main) {
  main();
}
