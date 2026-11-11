/**
 * Generic repository file discovery shared by the policy checkers.
 *
 * `ja-space-files.ts` owns the ja-space-specific mode mapping; this module adds
 * an extension-agnostic walk so the pnpm-policy and suppression checkers can
 * reuse the same skip set and lockfile rules.
 */

import { lstatSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { isLockfileName, SKIP_DIRS } from "./ja-space-files.ts";

const walk = (dir: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name), out);
      }
    } else if (entry.isFile() && !isLockfileName(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
};

const collectOne = (full: string, out: string[]): void => {
  let stat: ReturnType<typeof lstatSync>;
  try {
    stat = lstatSync(full);
  } catch {
    return;
  }
  if (stat.isSymbolicLink()) {
    return;
  }
  if (stat.isDirectory()) {
    walk(full, out);
  } else if (stat.isFile() && !isLockfileName(basename(full))) {
    out.push(full);
  }
};

/** Collect every file reachable from explicit path arguments. */
export const collectFiles = (paths: readonly string[]): string[] => {
  const out: string[] = [];
  for (const input of paths) {
    collectOne(resolve(input), out);
  }
  return out;
};

/** Discover every file under `root`, skipping caches, output and lockfiles. */
export const discoverAllFiles = (root: string): string[] => {
  const out: string[] = [];
  walk(root, out);
  return out;
};

/** 1-based line and column for a character `index` in `input`. */
export const lineColumnAt = (
  input: string,
  index: number,
): { line: number; column: number } => {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index && i < input.length; i += 1) {
    if (input[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
};
