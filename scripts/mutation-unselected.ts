#!/usr/bin/env node
/**
 * Check the mutants that `--since --include-test-changes` left out although a
 * changed test detected them at the base.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/mutation-unselected.ts <work-dir>
 *
 * `<work-dir>` holds the baseline's `base-report.json` and
 * `base-snapshot.json` (written by `scripts/mutation-diff.sh`); the current
 * report and snapshot are read from `.mutator/`. The mutants
 * `unselectedCandidates` picks (see `mutation-findings.ts` for why) run with
 * `mutator --only <key>... --kill-matrix`, and each one no test detects, or
 * whose status is unexpected, is an error. Exits 1 then, or when the run
 * fails.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeReport,
  failure,
  type MutationReport,
  reviewUnselected,
  scopeHashes,
  unselectedCandidates,
} from "./mutation-findings.ts";

const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));

const readReport = (path: string): MutationReport => {
  const decoded = decodeReport(readJson(path));
  if ("problem" in decoded) {
    throw new Error(`${path}: ${decoded.problem}`);
  }
  return decoded.report;
};

/** The mutator arguments that run `keys` and write the report to `directory`. */
export const onlyArguments = (
  keys: readonly string[],
  directory: string,
): readonly string[] => [
  "exec",
  "mutator",
  ...keys.flatMap((key) => ["--only", key]),
  "--kill-matrix",
  "--reporter",
  "json",
  "--report-dir",
  directory,
];

const lastLines = (text: string): string =>
  text.trim().split("\n").slice(-8).join("\n");

const check = (work: string): readonly string[] => {
  const base = readReport(join(work, "base-report.json"));
  const keys = unselectedCandidates(
    base,
    readReport(".mutator/report/mutation.json"),
    scopeHashes(readJson(join(work, "base-snapshot.json"))),
    scopeHashes(readJson(".mutator/snapshot.json")),
  );
  if (keys.length === 0) {
    return [];
  }
  process.stderr.write(
    `mutation:diff: running ${keys.length} mutants the diff did not select: ${keys.join(" ")}\n`,
  );
  const directory = join(work, "unselected");
  const result = spawnSync("pnpm", onlyArguments(keys, directory), {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "" },
  });
  const path = join(directory, "mutation.json");
  return result.status === 0 && existsSync(path)
    ? reviewUnselected(base, keys, readReport(path))
    : failure(
        "選ばれなかったミュータントを実行できなかった",
        `mutator --onlyが失敗しました: ${lastLines(`${result.stdout}${result.stderr}`)}`,
      ).lines;
};

if (import.meta.main) {
  const lines = check(process.argv[2] ?? ".");
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  process.exitCode = lines.length === 0 ? 0 : 1;
}
