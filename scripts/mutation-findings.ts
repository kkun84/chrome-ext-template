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
  readonly coveredBy: readonly string[];
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
  /** The source of each file when the report was written. */
  readonly sources: ReadonlyMap<string, string>;
  /** Test ids changed and removed since the baseline (`testChanges`). */
  readonly changedTests: readonly string[];
  readonly removedTests: readonly string[];
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
  | "source"
  | "status"
  | "killedBy"
  | "coveredBy"
  | "testChanges"
  | "changed"
  | "removed";

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
      coveredBy: strings(value.coveredBy),
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

const decodeSources = (value: JsonObject): ReadonlyMap<string, string> =>
  new Map(
    Object.entries(value).flatMap(([file, entry]) =>
      isObject(entry) && typeof entry.source === "string"
        ? [[file, entry.source] as const]
        : [],
    ),
  );

const decodeTestChanges = (
  value: unknown,
): Pick<MutationReport, "changedTests" | "removedTests"> => ({
  changedTests: isObject(value) ? strings(value.changed) : [],
  removedTests: isObject(value) ? strings(value.removed) : [],
});

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
      sources: decodeSources(files),
      ...decodeTestChanges(value.testChanges),
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

/**
 * Warn about changed files that decide what mutation testing checks.
 *
 * Editing mutator's settings can narrow the check or record a mutant that
 * changes behaviour as equivalent. Editing the Vitest config or a setup file
 * (`testSetupFiles`, the resolved `setupFiles` / `globalSetup`) can make
 * every assertion pass. No test fails because of either, so a person has to
 * look.
 */
export const reviewSettingChanges = (
  changedFiles: readonly string[],
  testSetupFiles: readonly string[] = [],
): readonly string[] => {
  const setup = new Set(testSetupFiles);
  return changedFiles.flatMap((file) => {
    if (isMutationSetting(file)) {
      return [
        formatAnnotation({
          level: "warning",
          title: "ミューテーションテストの設定が変わった",
          file,
          message: `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わるミュータントを記録していないかを確かめてください。`,
        }),
      ];
    }
    if (isVitestConfig(file) || setup.has(file)) {
      return [
        formatAnnotation({
          level: "warning",
          title: "テストの設定や準備ファイルが変わった",
          file,
          message: `${file}が変わりました。テストの設定や準備ファイルは、アサーションを無力化するなど、ミューテーションテストでは見つからない形でテストを弱められます。人が確かめてください。`,
        }),
      ];
    }
    return [];
  });
};

/** Statuses that count as undetected now. */
const UNDETECTED = new Set(["Survived", "NoCoverage"]);

/**
 * Whether a mutant the baseline recorded as `Timeout` lost its detection.
 *
 * A `Timeout` carries no killing or covering tests, and a busy machine can
 * time out a mutant no test detects. So it counts only when the change can
 * explain the loss: no test reaches the mutant any more (a mutant no test
 * reaches is never run, so it cannot have timed out before), a test that
 * covers it changed, or the change removed tests.
 */
const lostTimeout = (current: MutationReport, mutant: MutantRecord): boolean =>
  mutant.status === "NoCoverage" ||
  current.removedTests.length > 0 ||
  mutant.coveredBy.some((test) => current.changedTests.includes(test));

/**
 * Detection regressions found by comparing the baseline's report with the
 * current one, for mutants of files whose source did not change.
 *
 * mutator reports a regression only when the baseline verdict was `Killed`.
 * On a busy machine the baseline can record `Timeout` for a mutant a test
 * detects, and the regression then goes unreported. An unchanged source means
 * every function in the file is unchanged, which mutator requires too.
 */
export const crossCheckRegressions = (
  base: MutationReport,
  current: MutationReport,
): readonly MutationFinding[] =>
  [...current.files].flatMap(([file, mutants]) => {
    const source = current.sources.get(file);
    if (source === undefined || base.sources.get(file) !== source) {
      return [];
    }
    const before = new Map(
      (base.files.get(file) ?? []).map((mutant) => [mutant.id, mutant]),
    );
    return mutants.flatMap((mutant) => {
      const old = before.get(mutant.id);
      const lost =
        old !== undefined &&
        UNDETECTED.has(mutant.status ?? "") &&
        (old.status === "Killed" ||
          (old.status === "Timeout" && lostTimeout(current, mutant)));
      return lost
        ? [
            {
              kind: "detectionRegression",
              key: mutant.id,
              previousKillers: old.killedBy,
            },
          ]
        : [];
    });
  });

/**
 * The scope hash of each mutant in a mutator snapshot (format 2: rows of
 * `[key, file, scope, scopeHash, status, ...]`, node_modules/@mizchi/mutator/
 * src/snapshot.ts). An unknown format yields an empty map, so nothing is
 * taken as unchanged.
 */
export const scopeHashes = (snapshot: unknown): ReadonlyMap<string, string> => {
  if (
    typeof snapshot !== "object" ||
    snapshot === null ||
    !("format" in snapshot) ||
    snapshot.format !== 2 ||
    !("rows" in snapshot) ||
    !Array.isArray(snapshot.rows)
  ) {
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

/** How many times a recheck runs each mutant. */
export const RECHECKS = 2;

/**
 * Mutants to run again without the previous results.
 *
 * mutator keeps a previous `Killed` verdict while any of the tests that
 * killed the mutant is unchanged. On a busy machine an unrelated test can
 * fail by chance while a mutant runs and is then recorded as one of its
 * killers. If the change weakens the test that really detected the mutant,
 * the unrelated, unchanged killer keeps the old verdict, and mutator reports
 * no regression. So a mutant is run again when the baseline killed it with
 * both changed or removed tests and unchanged ones, its function is
 * unchanged, it still counts as detected, and mutator did not already report
 * it. Mutants whose killers all changed are run again by mutator itself.
 */
export const recheckCandidates = (
  base: MutationReport,
  current: MutationReport,
  baseScopes: ReadonlyMap<string, string>,
  currentScopes: ReadonlyMap<string, string>,
): readonly string[] => {
  const touched = new Set([...current.changedTests, ...current.removedTests]);
  const reported = new Set(
    current.findings
      .filter((finding) => finding.kind === "detectionRegression")
      .map((finding) => finding.key),
  );
  const before = new Map(
    [...base.files.values()].flat().map((mutant) => [mutant.id, mutant]),
  );
  return [...current.files.values()]
    .flat()
    .filter((mutant) => {
      const old = before.get(mutant.id);
      const scope = baseScopes.get(mutant.id);
      return (
        old !== undefined &&
        old.status === "Killed" &&
        old.killedBy.some((test) => touched.has(test)) &&
        old.killedBy.some((test) => !touched.has(test)) &&
        (mutant.status === "Killed" || mutant.status === "Timeout") &&
        !reported.has(mutant.id) &&
        scope !== undefined &&
        scope === currentScopes.get(mutant.id)
      );
    })
    .map((mutant) => mutant.id)
    .sort();
};

/** An error for each rechecked mutant that one of the reruns did not detect. */
export const reviewRechecked = (
  current: MutationReport,
  keys: readonly string[],
  reruns: readonly MutationReport[],
): readonly string[] => {
  const statuses = reruns.map(
    (rerun) =>
      new Map(
        [...rerun.files.values()].flat().map((mutant) => [mutant.id, mutant]),
      ),
  );
  return keys
    .filter((key) =>
      statuses.some((status) => UNDETECTED.has(status.get(key)?.status ?? "")),
    )
    .map((key) => {
      const { change, place } = placeMutant(current, key);
      return formatAnnotation({
        level: "error",
        title: "テストが弱くなった",
        message: `変わっていないコードのミュータント${key}${change}を、前の結果を使わずに実行し直すと、どのテストも検出しません。基準では変えたテストと変わっていないテストの両方が検出したと記録されていたため、mutatorは前の結果を使っていました。${REGRESSION_ADVICE}`,
        ...place,
      });
    });
};

/**
 * Review the findings of a report.
 *
 * Fails when the report has a detection regression, or when mutator had no
 * baseline to compare with. With the baseline's own report, regressions are
 * also found by comparing the two (`crossCheckRegressions`).
 */
export const reviewFindings = (
  report: MutationReport,
  base?: MutationReport,
): Review => {
  if (report.comparison === "unavailable") {
    return { lines: [formatAnnotation(unmeasured)], exitCode: 1 };
  }
  const reported = report.findings.filter(
    (finding) => finding.kind === "detectionRegression",
  );
  const reportedKeys = new Set(reported.map((finding) => finding.key));
  const regressed = [
    ...reported,
    ...(base === undefined ? [] : crossCheckRegressions(base, report)).filter(
      (finding) => !reportedKeys.has(finding.key),
    ),
  ];
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
      ...[...regressions, ...idle, ...gaps].map(formatAnnotation),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件、テストが検出できないミュータント: ${gaps.length}件`,
    ],
    exitCode: regressions.length === 0 ? 0 : 1,
  };
};
