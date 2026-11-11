#!/usr/bin/env node
/**
 * CLI shell for the Japanese typography checker.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/lint-ja-space.ts [--fix] [paths...]
 *
 * With no paths it walks the repo, skipping build output, caches, lockfiles
 * and symlinks. Exits 1 when any violation is found (unless `--fix` removes
 * them all).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectJaSpace, fixJaSpace } from "./ja-space.ts";
import {
  collectPaths,
  discoverFiles,
  type FoundFile,
} from "./ja-space-files.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Outcome of checking a single file. */
interface FileResult {
  readonly display: string;
  readonly fixed: number;
  readonly lines: readonly string[];
}

const checkFile = (file: FoundFile, fix: boolean): FileResult => {
  const display = relative(REPO_ROOT, file.path) || file.path;
  const source = readFileSync(file.path, "utf8");
  if (fix) {
    const { fixed, violations } = fixJaSpace(source, { mode: file.mode });
    if (violations.length > 0) {
      writeFileSync(file.path, fixed);
    }
    return { display, fixed: violations.length, lines: [] };
  }
  const lines = detectJaSpace(source, { mode: file.mode }).map(
    (violation) =>
      `${display}:${violation.line}:${violation.column}: ` +
      `remove the space between Japanese and ASCII (${violation.direction})`,
  );
  return { display, fixed: 0, lines };
};

const main = (): void => {
  const { output, exitCode } = run(process.argv.slice(2));
  process.stdout.write(output);
  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
};

/** Run the checker for `args` and return the output plus an exit code. */
export const run = (
  args: readonly string[],
): { output: string; exitCode: number } => {
  const fix = args.includes("--fix");
  const pathArgs = args.filter((arg) => !arg.startsWith("--"));
  const files =
    pathArgs.length > 0 ? collectPaths(pathArgs) : discoverFiles(REPO_ROOT);

  const results = files.map((file) => checkFile(file, fix));
  const findings = results.reduce(
    (total, result) => total + result.fixed + result.lines.length,
    0,
  );

  if (fix) {
    const changed = results.filter((result) => result.fixed > 0).length;
    return {
      output: `ja-space: fixed ${findings} violation(s) in ${changed} file(s)\n`,
      exitCode: 0,
    };
  }
  const body = results.flatMap((result) => result.lines).join("\n");
  const summary =
    findings > 0
      ? `ja-space: ${findings} violation(s) found\n`
      : "ja-space: no violations found\n";
  const output = body.length > 0 ? `${body}\n${summary}` : summary;
  return { output, exitCode: findings > 0 ? 1 : 0 };
};

if (import.meta.main) {
  main();
}
