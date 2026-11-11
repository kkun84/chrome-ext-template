#!/usr/bin/env node
/**
 * CLI shell for the pnpm supply-chain policy checker.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/lint-pnpm-policy.ts [root]
 *
 * With no argument it checks this repository. Exits 1 on findings and prints
 * one `file:line:col: message` line per finding plus a final count. These
 * findings are not auto-fixable.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRepo, formatFinding } from "./pnpm-policy.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

/** Run the checker for `args` and return the output plus an exit code. */
export const run = (
  args: readonly string[],
): { output: string; exitCode: number } => {
  const pathArgs = args.filter((arg) => !arg.startsWith("--"));
  const rootArg = pathArgs[0];
  const root = rootArg === undefined ? REPO_ROOT : resolve(rootArg);
  const findings = checkRepo(root);

  if (findings.length === 0) {
    return { output: "pnpm-policy: no violations found\n", exitCode: 0 };
  }
  const body = findings.map(formatFinding).join("\n");
  return {
    output: `${body}\npnpm-policy: ${findings.length} violation(s) found\n`,
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
