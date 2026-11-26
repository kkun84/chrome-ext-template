/**
 * Pure library that turns a mutator JSON report into GitHub Actions
 * annotations and decides whether the change weakened the tests.
 *
 * A `detectionRegression` finding means a test detected a mutant of unchanged
 * code before, and no test detects it now: the change weakened or removed a
 * test. That fails, and so does a report that could not be compared with the
 * baseline or does not have the expected shape: either way nothing shows that
 * the tests kept their strength. A `newTestNoKills` finding (a new test that
 * detects no mutant) and an undetected mutant (`mutationGap`) are warnings.
 * The CLI shell is `check-mutation-findings.ts`.
 */

/** Where a mutant starts in its source file. */
interface MutantLocation {
  readonly line?: number;
}

/** The part of a mutant in the report that the annotations use. */
export interface MutantRecord {
  readonly id: string;
  readonly mutatorName?: string;
  readonly replacement?: string;
  readonly start?: MutantLocation;
  /** `Killed`, `Survived`, `NoCoverage`, `Timeout`, `Pending`, ... */
  readonly status?: string;
  readonly killedBy: readonly string[];
}

/** One entry of the report's `findings`. */
export interface MutationFinding {
  readonly kind: string;
  readonly key?: string;
  readonly test?: string;
  readonly previousKillers: readonly string[];
}

/** The part of `.mutator/report/mutation.json` that the review reads. */
export interface MutationReport {
  /** `unavailable` when mutator found no compatible baseline snapshot. */
  readonly comparison: "available" | "unavailable";
  readonly findings: readonly MutationFinding[];
  /** Mutants per source file, keyed by the path relative to the root. */
  readonly files: ReadonlyMap<string, readonly MutantRecord[]>;
  /** Changed test files the runner does not collect (`warnings`). */
  readonly uncollected: readonly string[];
  /** Test ids changed and removed since the baseline (`testChanges`). */
  readonly changedTests: readonly string[];
  readonly removedTests: readonly string[];
  /**
   * Tests mutator counted as changed when it selected mutants
   * (`selectionReasons[].tests`). Unlike `changedTests`, they include tests
   * whose helper changed while the test file did not.
   */
  readonly selectedTests: readonly string[];
}

/** A decoded report, or why the value is not a report this script reads. */
export type DecodedReport =
  | { readonly report: MutationReport }
  | { readonly problem: string };

/** Output lines and the exit code for the CLI. */
export interface Review {
  readonly lines: readonly string[];
  readonly exitCode: 0 | 1;
}

interface Annotation {
  readonly level: "error" | "warning" | "notice";
  readonly title: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

/** The report fields this script reads. Other fields are ignored. */
type ReportField =
  | "schemaVersion"
  | "comparison"
  | "findings"
  | "files"
  | "mutants"
  | "id"
  | "mutatorName"
  | "replacement"
  | "location"
  | "start"
  | "line"
  | "kind"
  | "key"
  | "test"
  | "previousKillers"
  | "status"
  | "killedBy"
  | "warnings"
  | "file"
  | "testChanges"
  | "changed"
  | "removed"
  | "selectionReasons"
  | "tests";

type JsonObject = { readonly [field in ReportField]?: unknown };

/** The `schemaVersion` of the mutation-testing JSON that mutator 0.4 writes. */
const SCHEMA_VERSION = "2";

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = <Field extends ReportField>(
  value: JsonObject,
  field: Field,
): { readonly [key in Field]?: string } => {
  const text = value[field];
  return typeof text === "string"
    ? ({ [field]: text } as { readonly [key in Field]: string })
    : {};
};

const decodeLocation = (value: unknown): { start?: MutantLocation } => {
  if (!isObject(value) || !isObject(value.start)) {
    return {};
  }
  const line = value.start.line;
  return { start: typeof line === "number" ? { line } : {} };
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const decodeMutant = (value: unknown): readonly MutantRecord[] => {
  if (!isObject(value) || typeof value.id !== "string") {
    return [];
  }
  return [
    {
      id: value.id,
      ...stringField(value, "mutatorName"),
      ...stringField(value, "replacement"),
      ...stringField(value, "status"),
      ...decodeLocation(value.location),
      killedBy: strings(value.killedBy),
    },
  ];
};

const decodeFinding = (value: unknown): readonly MutationFinding[] => {
  if (!isObject(value) || typeof value.kind !== "string") {
    return [];
  }
  return [
    {
      kind: value.kind,
      ...stringField(value, "key"),
      ...stringField(value, "test"),
      previousKillers: strings(value.previousKillers),
    },
  ];
};

const decodeUncollected = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.flatMap((warning) =>
        isObject(warning) &&
        warning.kind === "uncollectedTest" &&
        typeof warning.file === "string"
          ? [warning.file]
          : [],
      )
    : [];

const decodeTestChanges = (
  value: unknown,
): Pick<MutationReport, "changedTests" | "removedTests"> => ({
  changedTests: isObject(value) ? strings(value.changed) : [],
  removedTests: isObject(value) ? strings(value.removed) : [],
});

const decodeSelectedTests = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.flatMap((reason) =>
            isObject(reason) ? strings(reason.tests) : [],
          ),
        ),
      ]
    : [];

const decodeFiles = (
  value: JsonObject,
): ReadonlyMap<string, readonly MutantRecord[]> =>
  new Map(
    Object.entries(value).map(([file, entry]) => {
      const mutants = isObject(entry) ? entry.mutants : undefined;
      return [
        file,
        Array.isArray(mutants) ? mutants.flatMap(decodeMutant) : [],
      ];
    }),
  );

const describeValue = (value: unknown): string =>
  value === undefined ? "ありません" : `${JSON.stringify(value)}です`;

/**
 * Read the fields the review needs from parsed report JSON.
 *
 * The top level must match mutator 0.4's report (`schemaVersion` 2 with
 * `comparison`, `findings` and `files`): a report without them would pass with
 * no findings, so it is a problem instead. Entries of an unknown shape inside
 * `findings` and `files` are dropped, so a newer mutator that adds kinds still
 * yields the findings this script understands.
 */
export const decodeReport = (value: unknown): DecodedReport => {
  if (!isObject(value)) {
    return { problem: "JSONのオブジェクトではありません。" };
  }
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return {
      problem: `schemaVersionが${describeValue(value.schemaVersion)}。このスクリプトは${SCHEMA_VERSION}だけを読みます。`,
    };
  }
  const { comparison, findings, files } = value;
  if (comparison !== "available" && comparison !== "unavailable") {
    return { problem: `comparisonが${describeValue(comparison)}。` };
  }
  if (!Array.isArray(findings)) {
    return { problem: "findingsの配列がありません。" };
  }
  if (!isObject(files)) {
    return { problem: "filesのオブジェクトがありません。" };
  }
  return {
    report: {
      comparison,
      findings: findings.flatMap(decodeFinding),
      files: decodeFiles(files),
      uncollected: decodeUncollected(value.warnings),
      ...decodeTestChanges(value.testChanges),
      selectedTests: decodeSelectedTests(value.selectionReasons),
    },
  };
};

const escapeData = (text: string): string =>
  text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

const escapeProperty = (text: string): string =>
  escapeData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

/** Format a workflow command such as `::error file=a.ts,line=3,title=t::m`. */
export const formatAnnotation = (annotation: Annotation): string => {
  const properties = [
    ...(annotation.file === undefined
      ? []
      : [`file=${escapeProperty(annotation.file)}`]),
    ...(annotation.line === undefined ? [] : [`line=${annotation.line}`]),
    `title=${escapeProperty(annotation.title)}`,
  ];
  return `::${annotation.level} ${properties.join(",")}::${escapeData(annotation.message)}`;
};

/** A review that fails with one error annotation. */
export const failure = (title: string, message: string): Review => ({
  lines: [formatAnnotation({ level: "error", title, message })],
  exitCode: 1,
});

const locate = (
  report: MutationReport,
  key: string,
): { readonly file: string; readonly mutant: MutantRecord } | undefined => {
  for (const [file, mutants] of report.files) {
    const mutant = mutants.find((candidate) => candidate.id === key);
    if (mutant !== undefined) {
      return { file, mutant };
    }
  }
  return undefined;
};

/** Where the mutant is, and the change it makes, for an annotation. */
const placeMutant = (
  report: MutationReport,
  key: string,
): {
  readonly change: string;
  readonly place: Pick<Annotation, "file" | "line">;
} => {
  const found = locate(report, key);
  const line = found?.mutant.start?.line;
  return {
    change:
      found?.mutant.mutatorName === undefined
        ? ""
        : `（${found.mutant.mutatorName}で${found.mutant.replacement ?? ""}に置き換え）`,
    place: {
      ...(found === undefined ? {} : { file: found.file }),
      ...(line === undefined ? {} : { line }),
    },
  };
};

const REGRESSION_ADVICE =
  "mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。";

const regression = (
  report: MutationReport,
  finding: MutationFinding,
): Annotation => {
  const key = finding.key ?? "";
  const { change, place } = placeMutant(report, key);
  const killers =
    finding.previousKillers.length === 0
      ? "テスト"
      : finding.previousKillers.map((killer) => `「${killer}」`).join("、");
  return {
    level: "error",
    title: "テストが弱くなった",
    message: `変わっていないコードのミュータント${key}${change}を、前は${killers}が検出していましたが、今はどのテストも検出しません。${REGRESSION_ADVICE}`,
    ...place,
  };
};

/** The test file of a test id such as `src/core/a.test.ts#suite > name`. */
const testFile = (test: string): Pick<Annotation, "file"> => {
  const hashAt = test.indexOf("#");
  return hashAt <= 0 ? {} : { file: test.slice(0, hashAt) };
};

const noKills = (finding: MutationFinding): Annotation => {
  const test = finding.test ?? "";
  return {
    level: "warning",
    title: "何も検出しない新しいテスト",
    message: `${test}は、測ったミュータントを1つも検出しません。アサーションを確かめてください。`,
    ...testFile(test),
  };
};

const guide = "node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md";

const gap = (report: MutationReport, finding: MutationFinding): Annotation => {
  const key = finding.key ?? "";
  const { change, place } = placeMutant(report, key);
  return {
    level: "warning",
    title: "テストが検出できないミュータント",
    message: `ミュータント${key}${change}は、どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。どんな入力でも振る舞いが変わらない等価ミュータントだけをmutator acceptで記録します。手順は${guide}にあります。`,
    ...place,
  };
};

const unmeasured: Annotation = {
  level: "error",
  title: "比べる基準を使えなかった",
  message:
    "mutatorが比べる基準（変更前のコミットで全件を実行した結果）を使えなかったため、テストが弱くなったかを確かめられません。基準と今とで、Node.jsの版、package.json、ロックファイル、tsconfig.json、pnpm-workspace.yaml、Vitestの設定、mutatorの設定のどれかが違います。基準はpnpm mutation:diff（scripts/mutation-diff.sh）で作ってください。そのうえで起きるなら、scripts/mutation-diff.shが基準へ写すファイルが足りません。",
};

/** True for `mutator.config.*` and `mutator.accepted.json` at the root. */
const isMutationSetting = (file: string): boolean =>
  file === "mutator.accepted.json" ||
  (file.startsWith("mutator.config.") && !file.includes("/"));

/** True for `vitest.config.*` at the root. */
const isVitestConfig = (file: string): boolean =>
  file.startsWith("vitest.config.") && !file.includes("/");

/** The review itself and what runs it: editing them can switch it off. */
const isJudge = (file: string): boolean =>
  file === "package.json" ||
  file === "lefthook.yml" ||
  file === "scripts/check-mutation-findings.ts" ||
  /^scripts\/mutation-[^/]+(?<!\.test)\.(?:ts|sh)$/u.test(file) ||
  /^\.github\/workflows\/[^/]+$/u.test(file);

const settingChange = (
  file: string,
  setup: ReadonlySet<string>,
): Annotation | undefined => {
  if (isMutationSetting(file)) {
    return {
      level: "warning",
      title: "ミューテーションテストの設定が変わった",
      file,
      message: `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わるミュータントを記録していないかを確かめてください。`,
    };
  }
  if (isVitestConfig(file) || setup.has(file)) {
    return {
      level: "warning",
      title: "テストの設定や準備ファイルが変わった",
      file,
      message: `${file}が変わりました。テストの設定や準備ファイルは、アサーションを無力化するなど、ミューテーションテストでは見つからない形でテストを弱められます。人が確かめてください。`,
    };
  }
  if (isJudge(file)) {
    return {
      level: "warning",
      title: "テストを弱めた変更の判定が変わった",
      file,
      message: `${file}が変わりました。判定のスクリプトや、それを動かす設定を書き換えると、テストを弱めた変更を通せます。人が確かめてください。`,
    };
  }
  return undefined;
};

/**
 * Warn about changed files that decide what mutation testing checks.
 *
 * Editing mutator's settings can narrow the check or record a mutant that
 * changes behaviour as equivalent. Editing the Vitest config or a setup file
 * (`testSetupFiles`, the resolved `setupFiles` / `globalSetup`) can make
 * every assertion pass. Editing the review or what runs it can switch it
 * off. No test fails because of any of them, so a person has to look.
 */
export const reviewSettingChanges = (
  changedFiles: readonly string[],
  testSetupFiles: readonly string[] = [],
): readonly string[] => {
  const setup = new Set(testSetupFiles);
  return [...new Set(changedFiles)].flatMap((file) => {
    const annotation = settingChange(file, setup);
    return annotation === undefined ? [] : [formatAnnotation(annotation)];
  });
};

/**
 * The lines of mutator's text reporter about a test the change skips
 * (`it.skip` and the like). The JSON report does not carry them
 * (`skippedMessage` in node_modules/@mizchi/mutator/src/report.ts).
 */
const SKIPPED =
  /^warning: (?<file>.+?):(?<line>\d+) skips a test in the change, so it checks nothing: (?<text>.*)$/gmu;

/** Warnings for the tests the change skips, from mutator's text output. */
export const reviewSkippedTests = (output: string): readonly string[] =>
  [...output.matchAll(SKIPPED)].map((match) =>
    formatAnnotation({
      level: "warning",
      title: "飛ばしたテスト",
      file: match.groups?.["file"] ?? "",
      line: Number(match.groups?.["line"]),
      message: `変更の中でテストを飛ばしています（${match.groups?.["text"] ?? ""}）。飛ばしたテストは何も確かめません。`,
    }),
  );

/**
 * A line of mutator's text reporter that says mutants of the diff were left
 * unrun (`--time-budget`, `--mutants-per-line`), or a status count with
 * `Pending` for the diff, such as `Survived 3 (1 not infected) · Pending 2`.
 * Settings like these can empty the review.
 */
const NOT_RUN =
  /^not run: .*$|^(?:\w+ \d+(?: \([^)]*\))? · )*Pending \d+(?: · .*)?$/mu;

/** An error when mutants of the diff were left unrun. */
export const reviewNotRun = (output: string): readonly string[] => {
  const match = NOT_RUN.exec(output);
  return match === null
    ? []
    : [
        formatAnnotation({
          level: "error",
          title: "変更の範囲のミュータントが実行されなかった",
          message: `mutatorが変更の範囲のミュータントを実行せずに残しました（${match[0]}）。mutator.config.*のtimeBudgetやmutantsPerLineなど、実行を減らす設定を確かめてください。実行されないミュータントでは、テストが弱くなったかを確かめられません。`,
        }),
      ];
};

/** Statuses that count as undetected. */
const UNDETECTED = new Set(["Survived", "NoCoverage"]);
/** Statuses that count as detected. */
const DETECTED = new Set(["Killed", "Timeout"]);

const isFormat2 = (
  snapshot: unknown,
): snapshot is {
  readonly format: 2;
  readonly rows?: unknown;
  readonly deps?: unknown;
} =>
  typeof snapshot === "object" &&
  snapshot !== null &&
  "format" in snapshot &&
  snapshot.format === 2;

/**
 * The scope hash of each mutant in a mutator snapshot (format 2: rows of
 * `[key, file, scope, scopeHash, status, ...]`, node_modules/@mizchi/mutator/
 * src/snapshot.ts). An unknown format yields an empty map, so nothing is
 * taken as unchanged.
 */
export const scopeHashes = (snapshot: unknown): ReadonlyMap<string, string> => {
  if (!isFormat2(snapshot) || !Array.isArray(snapshot.rows)) {
    return new Map();
  }
  return new Map(
    snapshot.rows.flatMap((row: unknown) =>
      Array.isArray(row) &&
      typeof row[0] === "string" &&
      typeof row[3] === "string"
        ? [[row[0], row[3]] as const]
        : [],
    ),
  );
};

/**
 * The files each test file loads, directly or not, from a mutator snapshot
 * (format 2: `deps`, the Vite module graph of the dry run, relative to the
 * root and without node_modules). An unknown format yields an empty map.
 */
export const snapshotDeps = (
  snapshot: unknown,
): ReadonlyMap<string, readonly string[]> => {
  if (!isFormat2(snapshot)) {
    return new Map();
  }
  const deps = snapshot.deps;
  return typeof deps === "object" && deps !== null && !Array.isArray(deps)
    ? new Map(
        Object.entries(deps).map(([file, loaded]) => [file, strings(loaded)]),
      )
    : new Map();
};

/** Merge the file lists of several `snapshotDeps` maps. */
export const mergeDeps = (
  ...maps: readonly ReadonlyMap<string, readonly string[]>[]
): ReadonlyMap<string, readonly string[]> => {
  const merged = new Map<string, Set<string>>();
  for (const map of maps) {
    for (const [file, loaded] of map) {
      const set = merged.get(file) ?? new Set<string>();
      for (const dep of loaded) {
        set.add(dep);
      }
      merged.set(file, set);
    }
  }
  return new Map([...merged].map(([file, set]) => [file, [...set].sort()]));
};

/** The file of a test id such as `src/core/a.test.ts#suite > name`. */
const fileOfTest = (test: string): string => {
  const hashAt = test.indexOf("#");
  return hashAt < 0 ? test : test.slice(0, hashAt);
};

/**
 * Whether the change touched a test: mutator says it changed, removed or
 * selected for it, or its file, or a file it loads (a helper, directly or
 * through other modules), is in the diff.
 *
 * mutator's `testChanges` keeps only tests whose own file is in the diff,
 * and its helper rule leaves out helpers it mutates (a helper under
 * `src/core`, say), so a weakened `expect` inside a helper would touch no
 * test without the module graph.
 */
export const touchedTests = (
  current: MutationReport,
  changedFiles: ReadonlySet<string>,
  deps: ReadonlyMap<string, readonly string[]>,
): ((test: string) => boolean) => {
  const named = new Set([
    ...current.changedTests,
    ...current.removedTests,
    ...current.selectedTests,
  ]);
  return (test) => {
    const file = fileOfTest(test);
    return (
      named.has(test) ||
      changedFiles.has(file) ||
      (deps.get(file) ?? []).some((dep) => changedFiles.has(dep))
    );
  };
};

const mutantsById = (
  report: MutationReport,
): ReadonlyMap<string, MutantRecord> =>
  new Map(
    [...report.files.values()].flat().map((mutant) => [mutant.id, mutant]),
  );

/**
 * Mutants the run left out although a touched test detected them.
 *
 * `--since --include-test-changes` selects the mutants that changed tests
 * cover. A mutant no test covers in the coverage run (one at module level,
 * such as a regular expression built when the module loads) is never
 * selected, so weakening the test that detected it at the base goes
 * unnoticed. These are the mutants the baseline killed with a test
 * `touched` accepts, whose function is unchanged, and which this run did not
 * decide (`Pending`, or missing from the report).
 */
export const unselectedCandidates = (
  base: MutationReport,
  current: MutationReport,
  baseScopes: ReadonlyMap<string, string>,
  currentScopes: ReadonlyMap<string, string>,
  touched: (test: string) => boolean,
): readonly string[] => {
  const now = mutantsById(current);
  return [...mutantsById(base).values()]
    .filter((mutant) => {
      const scope = baseScopes.get(mutant.id);
      const status = now.get(mutant.id)?.status;
      return (
        mutant.status === "Killed" &&
        mutant.killedBy.some(touched) &&
        scope !== undefined &&
        scope === currentScopes.get(mutant.id) &&
        (status === undefined || status === "Pending")
      );
    })
    .map((mutant) => mutant.id)
    .sort();
};

/**
 * Errors for the mutants `unselectedCandidates` picked, from the report of
 * running them with `--only`: one per mutant no test detects now, and one
 * per mutant whose status is neither detected nor undetected.
 */
export const reviewUnselected = (
  base: MutationReport,
  keys: readonly string[],
  rerun: MutationReport,
): readonly string[] => {
  const now = mutantsById(rerun);
  return keys.flatMap((key) => {
    const status = now.get(key)?.status;
    if (DETECTED.has(status ?? "")) {
      return [];
    }
    const { change, place } = placeMutant(base, key);
    return [
      formatAnnotation(
        UNDETECTED.has(status ?? "")
          ? {
              level: "error",
              title: "テストが弱くなった",
              message: `変わっていないコードのミュータント${key}${change}を、基準では、変えたか消したテスト（読み込むファイルが変わったテストを含む）が検出していましたが、今はどのテストも検出しません（範囲に選ばれなかったため、個別に実行して確かめました）。${REGRESSION_ADVICE}`,
              ...place,
            }
          : {
              level: "error",
              title: "ミュータントの結果が想定と違う",
              message: `変わっていないコードのミュータント${key}${change}を個別に実行しましたが、結果が${status ?? "ありません"}でした。検出したかどうかが分からないため、失敗にします。`,
              ...place,
            },
      ),
    ];
  });
};

/**
 * An error when a run that should have run every mutant left some
 * `Pending`: `timeBudget`, `mutantsPerLine` or `since` in mutator's settings
 * cut it short. A baseline without `Killed` hides every weakened test.
 */
export const reviewPending = (
  report: MutationReport,
  where: string,
): readonly string[] => {
  const pending = [...mutantsById(report).values()]
    .filter((mutant) => mutant.status === "Pending")
    .map((mutant) => mutant.id)
    .sort();
  return pending.length === 0
    ? []
    : [
        formatAnnotation({
          level: "error",
          title: "実行されなかったミュータントがある",
          message: `${where}で、ミュータント${pending.length}件（${pending.slice(0, 5).join("、")}${pending.length > 5 ? "など" : ""}）が実行されずにPendingのまま残りました。mutator.config.*のtimeBudget、mutantsPerLine、sinceなどで実行を打ち切ると、テストが弱くなったかを確かめられないため、失敗にします。`,
        }),
      ];
};

/**
 * Errors for the mutants a change of mutator's settings takes out of the
 * check while a touched test detected them.
 *
 * `ownSettings` is the baseline run with the base's own settings,
 * `newSettings` the baseline run with the current ones. A mutant killed in
 * the first and not detected or missing in the second disappeared because
 * of the settings (`excludedMutators`, `weakMutation`, `arid`, a plugin, and
 * so on), so the baseline and the change both lack it. When a touched test
 * killed it, weakening that test would go unnoticed. Other mutants the
 * settings drop are left to the warning about the changed settings.
 */
export const reviewSettingDrops = (
  ownSettings: MutationReport,
  newSettings: MutationReport,
  touched: (test: string) => boolean,
): readonly string[] => {
  const kept = mutantsById(newSettings);
  return [...mutantsById(ownSettings).values()]
    .filter(
      (mutant) =>
        mutant.status === "Killed" &&
        !DETECTED.has(kept.get(mutant.id)?.status ?? "") &&
        mutant.killedBy.some(touched),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((mutant) => {
      const { change, place } = placeMutant(ownSettings, mutant.id);
      const killers = mutant.killedBy
        .filter(touched)
        .map((killer) => `「${killer}」`)
        .join("、");
      const now = kept.get(mutant.id)?.status;
      return formatAnnotation({
        level: "error",
        title: "設定の変更で、変えたテストが確かめるミュータントが外れた",
        message: `ミュータント${mutant.id}${change}は、基準の元の設定では${killers}が検出していましたが、今のmutatorの設定では${now === undefined ? "作られません" : `${now}になります`}。変えたか消したテストが検出していたミュータントを設定で外すと、そのテストを弱めても見つかりません。設定を戻すか、テストの変更を戻してください。`,
        ...place,
      });
    });
};

/** Warnings for the test files mutator says the runner does not collect. */
const uncollected = (report: MutationReport): readonly Annotation[] =>
  report.uncollected.map((file) => ({
    level: "warning",
    title: "拾われないテストファイル",
    file,
    message: `${file}は変わりましたが、テストランナーが集めません。このファイルのテストは何も検出しません。vitest.config.*のinclude / excludeなどを確かめてください。`,
  }));

/**
 * Review the findings of a report.
 *
 * Fails when the report has a detection regression, or when mutator had no
 * baseline to compare with.
 */
export const reviewFindings = (report: MutationReport): Review => {
  if (report.comparison === "unavailable") {
    return { lines: [formatAnnotation(unmeasured)], exitCode: 1 };
  }
  const regressed = report.findings.filter(
    (finding) => finding.kind === "detectionRegression",
  );
  const regressedKeys = new Set(regressed.map((finding) => finding.key));
  const regressions = regressed.map((finding) => regression(report, finding));
  const idle = report.findings
    .filter((finding) => finding.kind === "newTestNoKills")
    .map(noKills);
  // A regressed mutant is also a gap. The error above already reports it.
  const gaps = report.findings
    .filter(
      (finding) =>
        finding.kind === "mutationGap" && !regressedKeys.has(finding.key),
    )
    .map((finding) => gap(report, finding));
  return {
    lines: [
      ...[...regressions, ...idle, ...gaps, ...uncollected(report)].map(
        formatAnnotation,
      ),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件、テストが検出できないミュータント: ${gaps.length}件`,
    ],
    exitCode: regressions.length === 0 ? 0 : 1,
  };
};
