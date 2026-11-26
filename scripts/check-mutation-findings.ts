#!/usr/bin/env node
/**
 * CLI shell for the mutation findings review.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/check-mutation-findings.ts [base-ref]
 *
 * Reads `.mutator/report/mutation.json` from the last mutator run and prints
 * GitHub Actions annotations: an error for each mutant the tests detected
 * before and no longer detect, a warning for each new test that detects
 * nothing, and a notice when there was no previous result to compare with.
 * With a base ref (e.g. `origin/main`) it also warns about changed
 * `mutator.config.*` / `mutator.accepted.json` since that ref. Exits 1 when
 * the tests got weaker or the report is missing.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decodeReport,
  type MutationReport,
  reviewFindings,
  reviewSettingChanges,
} from "./mutation-findings.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Where mutator's `json` reporter writes by default. */
const REPORT_PATH = ".mutator/report/mutation.json";

const isMissing = (error: unknown): boolean =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const loadReport = (root: string): MutationReport | undefined => {
  let text: string;
  try {
    text = readFileSync(join(root, REPORT_PATH), "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  }
  return decodeReport(JSON.parse(text));
};

const changedFiles = (root: string, base: string): readonly string[] =>
  execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file.length > 0);

/** Run the review for `args` in `root` and return the output and exit code. */
export const run = (
  args: readonly string[],
  root: string = REPO_ROOT,
): { output: string; exitCode: number } => {
  const base = args[0];
  const settings =
    base === undefined ? [] : reviewSettingChanges(changedFiles(root, base));
  const review = reviewFindings(loadReport(root), REPORT_PATH);
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
