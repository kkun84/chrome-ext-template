#!/usr/bin/env node
/**
 * Check what `--since --include-test-changes` cannot see.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/mutation-unselected.ts <work-dir> <merge-base>
 *   node ... scripts/mutation-unselected.ts --pending <report> <where>
 *
 * `<work-dir>` holds the baseline's `base-report.json` and
 * `base-snapshot.json`, and `base-own-report.json` when mutator's settings
 * changed (all written by `scripts/mutation-diff.sh`); the current report and
 * snapshot are read from `.mutator/`. A test counts as touched when mutator
 * names it, or when its file or a file it loads (the `deps` of the
 * snapshots) changed since `<merge-base>`, committed or not.
 *
 * - The mutants `unselectedCandidates` picks (see `mutation-findings.ts` for
 *   why) run with `mutator --only <key>... --kill-matrix`, and each one no
 *   test detects, or whose status is unexpected, is an error.
 * - With `base-own-report.json`, each mutant the new settings take out while
 *   a touched test killed it is an error (`reviewSettingDrops`).
 *
 * `--pending` fails when the report has a `Pending` mutant: the baseline must
 * run every mutant. Exits 1 on an error, or when a run fails.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeReport,
  failure,
  type MutationReport,
  mergeDeps,
  reviewNotRun,
  reviewPending,
  reviewSettingDrops,
  reviewUnselected,
  scopeHashes,
  snapshotDeps,
  touchedTests,
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

/**
 * The mutator arguments that run `keys` and write the report to `directory`.
 * The reporters are named so the settings cannot drop the text that
 * `reviewNotRun` reads.
 */
export const onlyArguments = (
  keys: readonly string[],
  directory: string,
): readonly string[] => [
  "exec",
  "mutator",
  ...keys.flatMap((key) => ["--only", key]),
  "--kill-matrix",
  "--reporter",
  "text",
  "--reporter",
  "json",
  "--report-dir",
  directory,
];

const lastLines = (text: string): string =>
  text.trim().split("\n").slice(-8).join("\n");

/** Files changed since `mergeBase`, committed or not, old and new names. */
const changedFiles = (mergeBase: string): ReadonlySet<string> => {
  const git = (args: readonly string[]): string =>
    execFileSync("git", args, { encoding: "utf8" });
  return new Set(
    [
      git(["diff", "--no-renames", "--name-only", mergeBase]),
      git(["ls-files", "--others", "--exclude-standard"]),
    ]
      .join("\n")
      .split("\n")
      .filter((file) => file.length > 0),
  );
};

const rerun = (
  base: MutationReport,
  keys: readonly string[],
  work: string,
): readonly string[] => {
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
    ? [
        ...reviewNotRun(result.stdout),
        ...reviewUnselected(base, keys, readReport(path)),
      ]
    : failure(
        "選ばれなかったミュータントを実行できなかった",
        `mutator --onlyが失敗しました: ${lastLines(`${result.stdout}${result.stderr}`)}`,
      ).lines;
};

const check = (work: string, mergeBase: string): readonly string[] => {
  const base = readReport(join(work, "base-report.json"));
  const current = readReport(".mutator/report/mutation.json");
  const baseSnapshot = readJson(join(work, "base-snapshot.json"));
  const currentSnapshot = readJson(".mutator/snapshot.json");
  const touched = touchedTests(
    current,
    changedFiles(mergeBase),
    mergeDeps(snapshotDeps(baseSnapshot), snapshotDeps(currentSnapshot)),
  );
  const ownPath = join(work, "base-own-report.json");
  const drops = existsSync(ownPath)
    ? reviewSettingDrops(readReport(ownPath), base, touched)
    : [];
  const keys = unselectedCandidates(
    base,
    current,
    scopeHashes(baseSnapshot),
    scopeHashes(currentSnapshot),
    touched,
  );
  return [...drops, ...(keys.length === 0 ? [] : rerun(base, keys, work))];
};

const main = (args: readonly string[]): readonly string[] => {
  if (args[0] === "--pending") {
    return reviewPending(readReport(args[1] ?? ""), args[2] ?? args[1] ?? "");
  }
  const [work, mergeBase] = args;
  if (work === undefined || mergeBase === undefined) {
    throw new Error(
      "usage: mutation-unselected.ts <work-dir> <merge-base> | --pending <report> <where>",
    );
  }
  return check(work, mergeBase);
};

if (import.meta.main) {
  const lines = main(process.argv.slice(2));
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  process.exitCode = lines.length === 0 ? 0 : 1;
}
