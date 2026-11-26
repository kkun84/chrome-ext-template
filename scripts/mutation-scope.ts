#!/usr/bin/env node
/**
 * What mutation testing looks at, for `scripts/mutation-diff.sh`.
 *
 * Usage:
 *   node --experimental-strip-types --disable-warning=ExperimentalWarning \
 *     scripts/mutation-scope.ts list --root <dir> \
 *       [--vitest-config <file>|none] [--mutator-config <file>|none]
 *   node ... scripts/mutation-scope.ts compare <base.json> <current.json> <base-commit>
 *   node ... scripts/mutation-scope.ts full-run --root <dir> [--mutator-config <file>]
 *
 * `list` prints JSON with, relative to the root:
 * - `configFiles`: each Vitest project's config file, `setupFiles` and
 *   `globalSetup` inside the root. mutator hashes them into its environment
 *   (the `configFiles()` of `@mizchi/mutator-vitest`, which is not a direct
 *   dependency, so the same files are read from Vitest here).
 * - `tests`: the test files Vitest collects.
 * - `sources`: the files mutator mutates (its `include` / `exclude`).
 *
 * `compare` fails when a test file or a mutated source file of the base is
 * still in the working tree (under its new name when git sees a rename) but
 * the current settings no longer collect it. Narrowing the settings would
 * otherwise drop tests or mutants from both the baseline and the change, and
 * nothing would look weaker.
 *
 * `full-run` fails when mutator's settings keep a run without `--since` from
 * running every mutant in a way no command line flag can undo: `since` turns
 * the baseline into a run of the diff, and `shard` runs a part of it.
 * (`timeBudget` and `mutantsPerLine` leave mutants `Pending`, which
 * `scripts/mutation-unselected.ts --pending` catches.)
 */

import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { loadConfig } from "@mizchi/mutator";
import { createVitest } from "vitest/node";
import { formatAnnotation } from "./mutation-findings.ts";

/** The parts of a resolved Vitest project that name files. */
export interface ProjectFiles {
  readonly configFile: string | false | undefined;
  readonly setupFiles: readonly string[];
  readonly globalSetup: string | readonly string[] | undefined;
}

/** The files mutation testing depends on, relative to the root. */
interface Scope {
  readonly configFiles: readonly string[];
  readonly tests: readonly string[];
  readonly sources: readonly string[];
}

/** `path` relative to `root` with `/`, or undefined outside it. */
const inside = (root: string, path: string): string | undefined => {
  if (!isAbsolute(path)) {
    return undefined;
  }
  const rel = relative(root, path);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`)) {
    return undefined;
  }
  return isAbsolute(rel) ? undefined : rel.split(sep).join("/");
};

/**
 * The files of `projects` inside `root`, relative to it, sorted.
 *
 * Files outside the root or in node_modules come with the installed
 * packages, so the baseline gets them from the lockfile instead.
 */
export const projectFiles = (
  root: string,
  projects: readonly ProjectFiles[],
): readonly string[] => {
  const files = new Set<string>();
  for (const project of projects) {
    for (const file of [
      ...(project.configFile ? [project.configFile] : []),
      ...project.setupFiles,
      ...[project.globalSetup ?? []].flat(),
    ]) {
      const path = inside(root, file);
      if (path !== undefined && !path.split("/").includes("node_modules")) {
        files.add(path);
      }
    }
  }
  return [...files].sort();
};

/**
 * Old path to new path for the renames in `git diff -M --name-status -z`.
 */
export const parseRenames = (output: string): ReadonlyMap<string, string> => {
  const fields = output.split("\0");
  const renames = new Map<string, string>();
  let index = 0;
  while (index < fields.length) {
    const status = fields[index] ?? "";
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = fields[index + 1];
      const to = fields[index + 2];
      if (status.startsWith("R") && from !== undefined && to !== undefined) {
        renames.set(from, to);
      }
      index += 3;
    } else {
      index += status === "" ? 1 : 2;
    }
  }
  return renames;
};

/**
 * Files collected at the base that still exist now (under their new name if
 * renamed) and are no longer collected. Deleted files are left to the
 * mutation run, which reports what their tests detected.
 */
export const droppedFiles = (
  base: readonly string[],
  current: readonly string[],
  renames: ReadonlyMap<string, string>,
  exists: (path: string) => boolean,
): readonly DroppedFile[] => {
  const collected = new Set(current);
  return base
    .map((from) => ({ file: renames.get(from) ?? from, from }))
    .filter(({ file }) => exists(file) && !collected.has(file))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
};

/** A file the base collected, and its path now. */
export interface DroppedFile {
  readonly file: string;
  readonly from: string;
}

const named = ({ file, from }: DroppedFile): string =>
  file === from ? file : `${file}（基準では${from}）`;

/** Error annotations for dropped tests and sources. */
export const reviewScope = (
  tests: readonly DroppedFile[],
  sources: readonly DroppedFile[],
): readonly string[] => [
  ...tests.map((dropped) =>
    formatAnnotation({
      level: "error",
      title: "テストが集められなくなった",
      file: dropped.file,
      message: `${named(dropped)}は基準ではVitestが集めていたテストファイルですが、今の設定では集めません。vitest.config.*のinclude / excludeや拡張子の変更で、テストを外していないかを確かめてください。外すなら、ファイルも消してください（消したテストが検出していたミュータントは、テストが弱くなったかで確かめます）。`,
    }),
  ),
  ...sources.map((dropped) =>
    formatAnnotation({
      level: "error",
      title: "ミューテーションテストの対象から外れた",
      file: dropped.file,
      message: `${named(dropped)}は基準ではmutatorの対象でしたが、今のmutator.config.*のinclude / excludeでは対象外です。対象から外すと、そのテストを弱めても検出できません。外す理由があるなら、人の判断でこのチェックを通してください。`,
    }),
  ),
];

/** mutator's defaults (node_modules/@mizchi/mutator/src/setup.ts). */
const DEFAULT_INCLUDE = ["src/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/*.d.ts",
  "**/*.{test,spec}.*",
  "**/__tests__/**",
];

const optionValue = (
  args: readonly string[],
  name: string,
): string | undefined => {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args[at + 1];
};

const listSources = async (
  root: string,
  file: string | undefined,
): Promise<readonly string[]> => {
  const loaded =
    file === "none"
      ? undefined
      : await loadConfig(root, file === undefined ? undefined : resolve(file));
  const config = loaded?.config ?? {};
  return globSync([...(config.include ?? DEFAULT_INCLUDE)], {
    cwd: root,
    exclude: [...DEFAULT_EXCLUDE, ...(config.exclude ?? [])],
  })
    .map((path) => path.split(sep).join("/"))
    .sort();
};

const list = async (args: readonly string[]): Promise<Scope> => {
  const root = realpathSync(resolve(optionValue(args, "--root") ?? "."));
  const vitestConfig = optionValue(args, "--vitest-config");
  const vitest = await createVitest(
    "test",
    {
      root,
      watch: false,
      run: true,
      ...(vitestConfig === undefined
        ? {}
        : { config: vitestConfig === "none" ? false : resolve(vitestConfig) }),
    },
    { logLevel: "silent" },
  );
  try {
    const configFiles = projectFiles(
      root,
      vitest.projects.map((project) => ({
        configFile: project.vite.config.configFile,
        setupFiles: project.config.setupFiles,
        globalSetup: project.config.globalSetup,
      })),
    ).filter((file) => existsSync(join(root, file)));
    const tests = [
      ...new Set(
        (await vitest.globTestSpecifications()).flatMap((spec) => {
          const path = inside(root, spec.moduleId);
          return path === undefined ? [] : [path];
        }),
      ),
    ].sort();
    return {
      configFiles,
      tests,
      sources: await listSources(root, optionValue(args, "--mutator-config")),
    };
  } finally {
    await vitest.close();
  }
};

/** Settings that keep a full run from running every mutant. */
const PARTIAL_SETTINGS = ["since", "shard"] as const;

/** Error annotations for the settings in `PARTIAL_SETTINGS` that are set. */
export const reviewFullRun = (
  config: { readonly [key in (typeof PARTIAL_SETTINGS)[number]]?: unknown },
  source: string,
): readonly string[] =>
  PARTIAL_SETTINGS.filter((key) => config[key] !== undefined).map((key) =>
    formatAnnotation({
      level: "error",
      title: "基準の全件を打ち切る設定がある",
      file: source,
      message: `${source}に${key}があります。${key}があると、基準を作る全件の実行が一部のミュータントだけの実行になり、テストが弱くなったかを確かめられないため、失敗にします。設定から外し、必要ならコマンドラインで渡してください。`,
    }),
  );

const fullRun = async (args: readonly string[]): Promise<number> => {
  const root = resolve(optionValue(args, "--root") ?? ".");
  const file = optionValue(args, "--mutator-config");
  const loaded =
    file === "none"
      ? undefined
      : await loadConfig(root, file === undefined ? undefined : resolve(file));
  const lines =
    loaded === undefined
      ? []
      : reviewFullRun(loaded.config, relative(root, loaded.path));
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return lines.length === 0 ? 0 : 1;
};

const readScope = (path: string): Scope =>
  JSON.parse(readFileSync(path, "utf8")) as Scope;

const compare = (args: readonly string[]): number => {
  const [basePath, currentPath, commit] = args;
  if (
    basePath === undefined ||
    currentPath === undefined ||
    commit === undefined
  ) {
    throw new Error("usage: compare <base.json> <current.json> <base-commit>");
  }
  const base = readScope(basePath);
  const current = readScope(currentPath);
  const renames = parseRenames(
    execFileSync(
      "git",
      ["diff", "--find-renames", "--name-status", "-z", commit],
      { encoding: "utf8" },
    ),
  );
  const exists = (path: string): boolean => existsSync(path);
  const lines = reviewScope(
    droppedFiles(base.tests, current.tests, renames, exists),
    droppedFiles(base.sources, current.sources, renames, exists),
  );
  process.stdout.write(lines.map((line) => `${line}\n`).join(""));
  return lines.length === 0 ? 0 : 1;
};

const main = async (): Promise<void> => {
  const [command, ...args] = process.argv.slice(2);
  if (command === "list") {
    process.stdout.write(`${JSON.stringify(await list(args))}\n`);
  } else if (command === "compare") {
    process.exitCode = compare(args);
  } else if (command === "full-run") {
    process.exitCode = await fullRun(args);
  } else {
    throw new Error("usage: mutation-scope.ts list|compare|full-run ...");
  }
};

if (import.meta.main) {
  await main();
}
