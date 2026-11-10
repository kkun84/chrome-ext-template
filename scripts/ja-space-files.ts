/**
 * File discovery for the Japanese typography checker.
 *
 * Kept separate from `ja-space.ts` (pure string logic) and `lint-ja-space.ts`
 * (process I/O) so it can be unit tested against a temporary directory.
 */

import { lstatSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { type MaskMode, modeForExtension } from "./ja-space.ts";

/** Directories that never contain lintable source. */
export const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  ".output",
  ".wxt",
  "coverage",
  ".direnv",
  ".fallow",
  ".rumdl_cache",
  "playwright-report",
  "test-results",
]);

const LOCKFILES: ReadonlySet<string> = new Set([
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "flake.lock",
  "actions.lock",
  "bun.lockb",
  "Cargo.lock",
]);

/** A file to check and the mask mode chosen for its extension. */
export interface FoundFile {
  readonly path: string;
  readonly mode: MaskMode;
}

/** True when a file name is a lockfile we must not lint. */
export const isLockfileName = (name: string): boolean =>
  LOCKFILES.has(name) || name.endsWith(".lock");

/** Add `name` under `dir` when it is a supported, non-lockfile file. */
export const addCandidate = (
  dir: string,
  name: string,
  out: FoundFile[],
): void => {
  if (isLockfileName(name)) {
    return;
  }
  const mode = modeForExtension(extname(name));
  if (mode !== null) {
    out.push({ path: join(dir, name), mode });
  }
};

/** Recursively walk `dir`, skipping build output, caches and symlinks. */
export const walk = (dir: string, out: FoundFile[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(join(dir, entry.name), out);
      }
    } else if (entry.isFile()) {
      addCandidate(dir, entry.name, out);
    }
  }
};

/** Collect the supported files reachable from explicit path arguments. */
export const collectPaths = (paths: readonly string[]): FoundFile[] => {
  const out: FoundFile[] = [];
  for (const input of paths) {
    collectOne(resolve(input), out);
  }
  return out;
};

const collectOne = (full: string, out: FoundFile[]): void => {
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
  } else if (stat.isFile()) {
    addCandidate(dirname(full), basename(full), out);
  }
};

/** Discover every supported file under `root`. */
export const discoverFiles = (root: string): FoundFile[] => {
  const out: FoundFile[] = [];
  walk(root, out);
  return out;
};
