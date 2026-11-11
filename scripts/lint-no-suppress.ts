#!/usr/bin/env node
/**
 * CLI shell for the suppression-comment checker.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/lint-no-suppress.ts [paths...]
 *
 * With no paths it walks the repo, skipping build output, caches, lockfiles,
 * Markdown and symlinks. Exits 1 on findings and prints one
 * `file:line:col: message` line per finding plus a final count. These findings
 * are not auto-fixable.
 */

import { readFileSync } from "node:fs";
import { dirname, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { collectFiles, discoverAllFiles } from "./lint-files.ts";
import { findSuppressions, isSupportedSuppressionFile } from "./no-suppress.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Run the checker for `args` and return the output plus an exit code. */
export const run = (
  args: readonly string[],
): { output: string; exitCode: number } => {
  const pathArgs = args.filter((arg) => !arg.startsWith("--"));
  const files =
    pathArgs.length > 0 ? collectFiles(pathArgs) : discoverAllFiles(REPO_ROOT);

  const lines: string[] = [];
  for (const file of files) {
    if (!isSupportedSuppressionFile(file)) {
      continue;
    }
    const display = relative(REPO_ROOT, file) || file;
    const content = readFileSync(file, "utf8");
    for (const finding of findSuppressions(
      content,
      extname(file).toLowerCase(),
    )) {
      lines.push(
        `${display}:${finding.line}:${finding.column}: ${finding.message}`,
      );
    }
  }

  if (lines.length === 0) {
    return { output: "no-suppress: no violations found\n", exitCode: 0 };
  }
  const body = lines.join("\n");
  return {
    output: `${body}\nno-suppress: ${lines.length} violation(s) found\n`,
    exitCode: 1,
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
