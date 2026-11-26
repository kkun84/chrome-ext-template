#!/usr/bin/env node
/**
 * Print the Vitest files that are part of mutator's environment hash.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/vitest-config-files.ts
 *
 * mutator hashes, besides package.json and the lockfiles, each Vitest
 * project's config file, `setupFiles` and `globalSetup` (the `configFiles()`
 * of `@mizchi/mutator-vitest`). That package is not a direct dependency, so
 * this script asks Vitest for the resolved config in the same way and prints
 * those files, one per line, relative to the repository root.
 * `scripts/mutation-diff.sh` copies them into the baseline worktree.
 */

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { createVitest } from "vitest/node";

/** The parts of a resolved Vitest project that name files. */
export interface ProjectFiles {
  readonly configFile: string | false | undefined;
  readonly setupFiles: readonly string[];
  readonly globalSetup: string | readonly string[] | undefined;
}

/**
 * The files of `projects` inside `root`, relative to it, sorted.
 *
 * Files outside the root (a setup file in a dependency) come with the
 * installed packages, so the baseline gets them from the lockfile instead.
 */
export const projectFiles = (
  root: string,
  projects: readonly ProjectFiles[],
): readonly string[] => {
  const files = new Set<string>();
  for (const project of projects) {
    const candidates = [
      ...(project.configFile ? [project.configFile] : []),
      ...project.setupFiles,
      ...[project.globalSetup ?? []].flat(),
    ];
    for (const file of candidates) {
      if (!isAbsolute(file)) {
        continue;
      }
      const path = relative(root, file);
      if (
        path !== "" &&
        !path.startsWith(`..${sep}`) &&
        path !== ".." &&
        !isAbsolute(path) &&
        !path.split(sep).includes("node_modules")
      ) {
        files.add(path.split(sep).join("/"));
      }
    }
  }
  return [...files].sort();
};

const main = async (): Promise<void> => {
  const root = resolve(process.cwd());
  const vitest = await createVitest(
    "test",
    { watch: false, run: true },
    { logLevel: "silent" },
  );
  try {
    const files = projectFiles(
      root,
      vitest.projects.map((project) => ({
        configFile: project.vite.config.configFile,
        setupFiles: project.config.setupFiles,
        globalSetup: project.config.globalSetup,
      })),
    ).filter((file) => existsSync(resolve(root, file)));
    process.stdout.write(files.map((file) => `${file}\n`).join(""));
  } finally {
    await vitest.close();
  }
};

if (import.meta.main) {
  await main();
}
