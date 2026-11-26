/**
 * Pure library that turns a mutator JSON report into GitHub Actions
 * annotations and decides whether the change weakened the tests.
 *
 * A `detectionRegression` finding means a test detected a mutant of unchanged
 * code before, and no test detects it now: the change weakened or removed a
 * test. That is the only kind that fails. A `newTestNoKills` finding (a new
 * test that detects no mutant) is a warning, and undetected mutants are only
 * counted. The CLI shell is `check-mutation-findings.ts`.
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
  /** `unavailable` when no compatible previous snapshot was found. */
  readonly comparison?: string;
  readonly findings: readonly MutationFinding[];
  /** Mutants per source file, keyed by the path relative to the root. */
  readonly files: ReadonlyMap<string, readonly MutantRecord[]>;
}

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
  | "previousKillers";

type JsonObject = { readonly [field in ReportField]?: unknown };

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

const decodeMutant = (value: unknown): readonly MutantRecord[] => {
  if (!isObject(value) || typeof value.id !== "string") {
    return [];
  }
  return [
    {
      id: value.id,
      ...stringField(value, "mutatorName"),
      ...stringField(value, "replacement"),
      ...decodeLocation(value.location),
    },
  ];
};

const decodeFinding = (value: unknown): readonly MutationFinding[] => {
  if (!isObject(value) || typeof value.kind !== "string") {
    return [];
  }
  const killers = value.previousKillers;
  return [
    {
      kind: value.kind,
      ...stringField(value, "key"),
      ...stringField(value, "test"),
      previousKillers: Array.isArray(killers)
        ? killers.filter((killer) => typeof killer === "string")
        : [],
    },
  ];
};

const decodeFiles = (
  value: unknown,
): ReadonlyMap<string, readonly MutantRecord[]> =>
  new Map(
    Object.entries(isObject(value) ? value : {}).map(([file, entry]) => {
      const mutants = isObject(entry) ? entry.mutants : undefined;
      return [
        file,
        Array.isArray(mutants) ? mutants.flatMap(decodeMutant) : [],
      ];
    }),
  );

/**
 * Read the fields the review needs from parsed report JSON.
 *
 * Returns `undefined` when the value is not an object. Entries of an unknown
 * shape are dropped instead of failing, so a report from a newer mutator still
 * yields the findings this script understands.
 */
export const decodeReport = (value: unknown): MutationReport | undefined => {
  if (!isObject(value)) {
    return undefined;
  }
  const findings = value.findings;
  return {
    ...stringField(value, "comparison"),
    findings: Array.isArray(findings) ? findings.flatMap(decodeFinding) : [],
    files: decodeFiles(value.files),
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

const regression = (
  report: MutationReport,
  finding: MutationFinding,
): Annotation => {
  const key = finding.key ?? "";
  const found = locate(report, key);
  const change =
    found?.mutant.mutatorName === undefined
      ? ""
      : `（${found.mutant.mutatorName}で${found.mutant.replacement ?? ""}に置き換え）`;
  const killers =
    finding.previousKillers.length === 0
      ? "テスト"
      : finding.previousKillers.map((killer) => `「${killer}」`).join("、");
  const line = found?.mutant.start?.line;
  return {
    level: "error",
    title: "テストが弱くなった",
    message: `変わっていないコードのミュータント${key}${change}を、前は${killers}が検出していましたが、今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。`,
    ...(found === undefined ? {} : { file: found.file }),
    ...(line === undefined ? {} : { line }),
  };
};

const noKills = (finding: MutationFinding): Annotation => ({
  level: "warning",
  title: "何も検出しない新しいテスト",
  message: `${finding.test ?? ""}は、測ったミュータントを1つも検出しません。アサーションを確かめてください。`,
});

const unmeasured: Annotation = {
  level: "notice",
  title: "比較の基準が無い",
  message:
    "前回の結果が無いか、依存、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。",
};

const guide = "node_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.md";

/** True for `mutator.config.*` and `mutator.accepted.json` at the root. */
const isMutationSetting = (file: string): boolean =>
  file === "mutator.accepted.json" ||
  (file.startsWith("mutator.config.") && !file.includes("/"));

/**
 * Warn about changed files that decide what mutation testing checks.
 *
 * Editing them can narrow the check or record a mutant that changes behaviour
 * as equivalent, and no test fails because of it.
 */
export const reviewSettingChanges = (
  changedFiles: readonly string[],
): readonly string[] =>
  changedFiles.filter(isMutationSetting).map((file) =>
    formatAnnotation({
      level: "warning",
      title: "ミューテーションテストの設定が変わった",
      file,
      message: `${file}が変わりました。検査する範囲が狭まっていないか、動作の変わるミュータントを記録していないかを確かめてください。`,
    }),
  );

/**
 * Review the findings of a report read from `path`.
 *
 * Fails when the report is missing or has a detection regression.
 */
export const reviewFindings = (
  report: MutationReport | undefined,
  path: string,
): Review => {
  if (report === undefined) {
    return {
      lines: [
        formatAnnotation({
          level: "error",
          title: "ミューテーションテストの結果が無い",
          message: `${path}がありません。先にmutatorをjsonのreporterで実行してください。`,
        }),
      ],
      exitCode: 1,
    };
  }
  const regressions = report.findings
    .filter((finding) => finding.kind === "detectionRegression")
    .map((finding) => regression(report, finding));
  const idle = report.findings
    .filter((finding) => finding.kind === "newTestNoKills")
    .map(noKills);
  const gaps = report.findings.filter(
    (finding) => finding.kind === "mutationGap",
  ).length;
  const notices = report.comparison === "unavailable" ? [unmeasured] : [];
  return {
    lines: [
      ...[...notices, ...regressions, ...idle].map(formatAnnotation),
      `テストが弱くなった箇所: ${regressions.length}件、何も検出しない新しいテスト: ${idle.length}件`,
      ...(gaps === 0
        ? []
        : [
            `テストが検出できなかったミュータント: ${gaps}件。テストが足りないのか、コードが要らないのかを見直してください。手順は${guide}にあります。`,
          ]),
    ],
    exitCode: regressions.length === 0 ? 0 : 1,
  };
};
