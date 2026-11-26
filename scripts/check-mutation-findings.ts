#!/usr/bin/env node
/**
 * CLI shell for the mutation findings review.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/check-mutation-findings.ts [base-ref] [--watch <file>]... \
 *     [--mutator-output <file>]
 *
 * Reads `.mutator/report/mutation.json` from the last mutator run and prints
 * GitHub Actions annotations: an error for each mutant the tests detected
 * before and no longer detect, a warning for each new test that detects
 * nothing, each mutant no test detects and each changed test file the runner
 * does not collect. With a base ref (e.g. `origin/main`) it also warns about
 * the files changed since the merge base, committed or not, that decide what
 * the review checks: mutator's and Vitest's settings, each `--watch` file
 * (the Vitest setup files), the review scripts, package.json, lefthook.yml
 * and the workflows. `--mutator-output` is the text mutator printed: a test
 * the change skips is a warning, and mutants of the diff left unrun are an
 * error. Exits 1 when the tests got weaker, when mutator had no baseline to
 * compare with, when mutants of the diff were not run, or when the report or
 * the ref cannot be read. `scripts/mutation-diff.sh` makes the baseline and
 * runs this.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeReport,
  failure,
  type MutationReport,
  type Review,
  reviewFindings,
  reviewNotRun,
  reviewSettingChanges,
  reviewSkippedTests,
} from "./mutation-findings.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Where mutator's `json` reporter writes by default. */
const REPORT_PATH = ".mutator/report/mutation.json";

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The decoded report at `path`, or a failing review that says why not. */
const loadReport = (
  path: string,
  label: string,
): { readonly report: MutationReport } | { readonly review: Review } => {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    return {
      review: isMissing(error)
        ? failure(
            "ミューテーションテストの結果が無い",
            `${label}がありません。先にpnpm mutation:diffを実行してください。`,
          )
        : failure(
            "ミューテーションテストの結果を読めない",
            `${label}を読めません: ${reasonOf(error)}`,
          ),
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      review: failure(
        "ミューテーションテストの結果を読めない",
        `${label}がJSONとして読めません: ${reasonOf(error)}`,
      ),
    };
  }
  const decoded = decodeReport(value);
  return "problem" in decoded
    ? {
        review: failure(
          "ミューテーションテストの結果の形が違う",
          `${label}は想定したmutator 0.4のレポートではありません: ${decoded.problem}`,
        ),
      }
    : decoded;
};

const reviewReport = (root: string): Review => {
  const current = loadReport(join(root, REPORT_PATH), REPORT_PATH);
  return "review" in current ? current.review : reviewFindings(current.report);
};

const git = (root: string, args: readonly string[]): string =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const changedFiles = (
  root: string,
  base: string,
): { readonly files: readonly string[] } | { readonly problem: string } => {
  try {
    // Uncommitted and untracked files count too, as they do for mutator's
    // --since.
    const mergeBase = git(root, ["merge-base", base, "HEAD"]).trim();
    const output = [
      git(root, ["diff", "--name-only", mergeBase]),
      git(root, ["ls-files", "--others", "--exclude-standard"]),
    ].join("\n");
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
  const valued = new Set(["--watch", "--mutator-output"]);
  const values = (name: string): readonly string[] =>
    args.flatMap((arg, index) => (args[index - 1] === name ? [arg] : []));
  const watched = values("--watch");
  const outputPath = values("--mutator-output")[0];
  const base = args.find(
    (arg, index) => !arg.startsWith("--") && !valued.has(args[index - 1] ?? ""),
  );
  const changed = base === undefined ? { files: [] } : changedFiles(root, base);
  const review =
    "problem" in changed
      ? failure(
          "基準のrefと比べられない",
          `${base}との差分を取れません。refの名前と、履歴を取得しているか（CIではfetch-depth: 0）を確かめてください: ${changed.problem}`,
        )
      : reviewReport(root);
  const settings =
    "problem" in changed ? [] : reviewSettingChanges(changed.files, watched);
  const mutatorOutput =
    outputPath === undefined ? "" : readFileSync(outputPath, "utf8");
  const notRun = reviewNotRun(mutatorOutput);
  return {
    output: `${[...settings, ...reviewSkippedTests(mutatorOutput), ...notRun, ...review.lines].join("\n")}\n`,
    exitCode: notRun.length > 0 ? 1 : review.exitCode,
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
