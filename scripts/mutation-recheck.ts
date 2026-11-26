#!/usr/bin/env node
/**
 * Run again the mutants whose detection mutator took from the baseline.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/mutation-recheck.ts <work-dir>
 *
 * `<work-dir>` holds the baseline's `base-report.json` and
 * `base-snapshot.json` (written by `scripts/mutation-diff.sh`). The current
 * report and snapshot are read from `.mutator/`. For each candidate of
 * `recheckCandidates` (see `mutation-findings.ts` for why), this runs
 * `mutator --only` `RECHECKS` times without the previous results, puts the
 * current `.mutator` back, and prints an error for each mutant a rerun did
 * not detect. Exits 1 then, or when a rerun fails.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  decodeReport,
  failure,
  type MutationReport,
  RECHECKS,
  recheckCandidates,
  reviewRechecked,
  scopeHashes,
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

/** The mutants to run again, with the current report. */
const candidates = (
  work: string,
): { readonly current: MutationReport; readonly keys: readonly string[] } => {
  const baseSnapshot = join(work, "base-snapshot.json");
  const currentSnapshot = ".mutator/snapshot.json";
  const current = readReport(".mutator/report/mutation.json");
  if (!existsSync(baseSnapshot) || !existsSync(currentSnapshot)) {
    return { current, keys: [] };
  }
  const keys = recheckCandidates(
    readReport(join(work, "base-report.json")),
    current,
    scopeHashes(readJson(baseSnapshot)),
    scopeHashes(readJson(currentSnapshot)),
  );
  return { current, keys };
};

/** One `mutator --only` run with no `.mutator`: its report, or the failure. */
const rerun = (
  keys: readonly string[],
  directory: string,
): MutationReport | string => {
  rmSync(".mutator", { recursive: true, force: true });
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "mutator",
      ...keys.flatMap((key) => ["--only", key]),
      "--reporter",
      "json",
      "--report-dir",
      directory,
    ],
    { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } },
  );
  const path = join(directory, "mutation.json");
  return result.status === 0 && existsSync(path)
    ? readReport(path)
    : `${result.stdout}${result.stderr}`
        .trim()
        .split("\n")
        .slice(-8)
        .join("\n");
};

/** Rerun `RECHECKS` times, keeping the current `.mutator` aside meanwhile. */
const rerunAll = (
  keys: readonly string[],
  work: string,
): readonly MutationReport[] | string => {
  const held = join(work, "held-mutator");
  cpSync(".mutator", held, { recursive: true });
  try {
    const reports: MutationReport[] = [];
    for (let attempt = 1; attempt <= RECHECKS; attempt += 1) {
      const result = rerun(keys, join(work, `recheck-${attempt}`));
      if (typeof result === "string") {
        return result;
      }
      reports.push(result);
    }
    return reports;
  } finally {
    rmSync(".mutator", { recursive: true, force: true });
    cpSync(held, ".mutator", { recursive: true });
  }
};

const workDirectory = (): string => {
  const work = process.argv[2];
  if (work === undefined) {
    throw new Error("usage: mutation-recheck.ts <work-dir>");
  }
  return work;
};

const main = (): number => {
  const work = workDirectory();
  const { current, keys } = candidates(work);
  if (keys.length === 0) {
    return 0;
  }
  process.stderr.write(
    `mutation:diff: running ${keys.length} mutants again without the previous results (${RECHECKS} times): ${keys.join(" ")}\n`,
  );
  const reruns = rerunAll(keys, work);
  const lines =
    typeof reruns === "string"
      ? failure(
          "ミューテーションテストの実行し直しが失敗した",
          `mutator --onlyが失敗しました: ${reruns}`,
        ).lines
      : reviewRechecked(current, keys, reruns);
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return lines.length === 0 ? 0 : 1;
};

if (import.meta.main) {
  process.exitCode = main();
}
