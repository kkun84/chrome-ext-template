import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  crossCheckRegressions,
  decodeReport,
  formatAnnotation,
  type MutationReport,
  recheckCandidates,
  reviewFindings,
  reviewRechecked,
  reviewSettingChanges,
  scopeHashes,
} from "./mutation-findings.ts";

const REGRESSION_ADVICE =
  "今はどのテストも検出しません。mutator acceptで通さないでください。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。";

const GAP_ADVICE =
  "どのテストも検出しません。テストが足りないのか、コードが要らないのかを見直してください。どんな入力でも振る舞いが変わらない等価ミュータントだけをmutator acceptで記録します。手順はnode_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.mdにあります。";

const report = (value: unknown): MutationReport => {
  const decoded = decodeReport(value);
  if ("problem" in decoded) {
    throw new Error(`fixture is not a report: ${decoded.problem}`);
  }
  return decoded.report;
};

/** An excerpt of a report that mutator 0.4.5 wrote. */
const fixture = (name: string): MutationReport =>
  report(
    JSON.parse(
      readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
    ),
  );

const files = {
  "src/core/tabs.ts": {
    language: "typescript",
    mutants: [
      {
        id: "other",
        mutatorName: "BooleanLiteral",
        replacement: "true",
        location: { start: { line: 3, column: 1 } },
      },
      {
        id: "weak",
        mutatorName: "EqualityOperator",
        replacement: "a === b",
        location: { start: { line: 12, column: 5 }, end: { line: 12 } },
      },
    ],
  },
};

const base = { schemaVersion: "2", comparison: "available", files } as const;

describe("reviewFindings", () => {
  it("fails on a detection regression in a report from mutator 0.4.5", () => {
    expect(reviewFindings(fixture("mutator-0.4.5-regression.json"))).toEqual({
      lines: [
        `::error file=src/core/tabs.ts,line=37,title=テストが弱くなった::変わっていないコードのミュータント1gfsysf9ilu（ConditionalExpressionでfalseに置き換え）を、前は「src/core/tabs.test.ts#selectPersistableUrl > prefers the active tab over an earlier tab in the last-focused window」が検出していましたが、${REGRESSION_ADVICE}`,
        `::warning file=src/core/tabs.ts,line=31,title=テストが検出できないミュータント::ミュータント1j1pdhef46w（FnValueで{ return ""; }に置き換え）は、${GAP_ADVICE}`,
        "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 1件",
      ],
      exitCode: 1,
    });
  });

  it("warns on the test file about a new test that detects nothing in a report from mutator 0.4.5", () => {
    expect(
      reviewFindings(fixture("mutator-0.4.5-new-test-no-kills.json")),
    ).toEqual({
      lines: [
        "::warning file=src/core/tabs.test.ts,title=何も検出しない新しいテスト::src/core/tabs.test.ts#selectPersistableUrl (no assertions) > only calls itは、測ったミュータントを1つも検出しません。アサーションを確かめてください。",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 1件、テストが検出できないミュータント: 0件",
      ],
      exitCode: 0,
    });
  });

  it("lists every previous killer of a regressed mutant", () => {
    const review = reviewFindings(
      report({
        ...base,
        findings: [
          {
            kind: "detectionRegression",
            key: "weak",
            previousKillers: [
              "src/core/tabs.test.ts#a",
              "src/core/tabs.test.ts#b",
            ],
          },
        ],
      }),
    );
    expect(review.lines[0]).toBe(
      `::error file=src/core/tabs.ts,line=12,title=テストが弱くなった::変わっていないコードのミュータントweak（EqualityOperatorでa === bに置き換え）を、前は「src/core/tabs.test.ts#a」、「src/core/tabs.test.ts#b」が検出していましたが、${REGRESSION_ADVICE}`,
    );
    expect(review.exitCode).toBe(1);
  });

  it("fails without a file or line when the mutant cannot be located", () => {
    const review = reviewFindings(
      report({
        ...base,
        findings: [
          { kind: "detectionRegression", key: "gone", previousKillers: [] },
          { kind: "detectionRegression", key: "bare" },
        ],
        files: { "src/core/url.ts": { mutants: [{ id: "bare" }] } },
      }),
    );
    expect(review.lines.slice(0, 2)).toEqual([
      `::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、${REGRESSION_ADVICE}`,
      `::error file=src/core/url.ts,title=テストが弱くなった::変わっていないコードのミュータントbareを、前はテストが検出していましたが、${REGRESSION_ADVICE}`,
    ]);
    expect(review.exitCode).toBe(1);
  });

  it("warns without a file about a new test whose id has no file", () => {
    expect(
      reviewFindings(
        report({
          ...base,
          findings: [{ kind: "newTestNoKills", test: "#bare" }],
        }),
      ).lines[0],
    ).toBe(
      "::warning title=何も検出しない新しいテスト::#bareは、測ったミュータントを1つも検出しません。アサーションを確かめてください。",
    );
  });

  it("passes when nothing got weaker", () => {
    expect(
      reviewFindings(
        report({
          ...base,
          findings: [
            { kind: "testNotMeasured", test: "src/core/tabs.test.ts#other" },
          ],
        }),
      ),
    ).toEqual({
      lines: [
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件",
      ],
      exitCode: 0,
    });
  });

  it("fails when there was no baseline to compare with", () => {
    const review = reviewFindings(
      report({ ...base, comparison: "unavailable", findings: [] }),
    );
    expect(review.exitCode).toBe(1);
    expect(review.lines).toHaveLength(1);
    expect(review.lines[0]).toMatch(
      /^::error title=比べる基準を使えなかった::/,
    );
  });
});

describe("crossCheckRegressions", () => {
  const mutant = (id: string, status: string, killedBy: string[] = []) => ({
    id,
    mutatorName: "BooleanLiteral",
    replacement: "true",
    location: { start: { line: 3, column: 1 } },
    status,
    killedBy,
  });
  const reportOf = (source: string, mutants: readonly unknown[]) =>
    report({
      ...base,
      findings: [],
      files: { "src/core/a.ts": { source, mutants } },
    });

  it("reports a mutant of an unchanged file that was killed or timed out and is undetected now", () => {
    const before = reportOf("code", [
      mutant("timeout", "Timeout"),
      mutant("killed", "Killed", ["src/core/a.test.ts#a"]),
      mutant("survived", "Survived"),
      mutant("still", "Killed", ["src/core/a.test.ts#a"]),
    ]);
    const after = reportOf("code", [
      mutant("timeout", "NoCoverage"),
      mutant("killed", "Survived"),
      mutant("survived", "Survived"),
      mutant("still", "Killed", ["src/core/a.test.ts#b"]),
    ]);
    expect(crossCheckRegressions(before, after)).toEqual([
      { kind: "detectionRegression", key: "timeout", previousKillers: [] },
      {
        kind: "detectionRegression",
        key: "killed",
        previousKillers: ["src/core/a.test.ts#a"],
      },
    ]);
  });

  it("counts a baseline timeout only when the change can explain the loss", () => {
    const before = reportOf("code", [
      mutant("covered", "Timeout"),
      mutant("changed", "Timeout"),
    ]);
    const after = report({
      ...base,
      findings: [],
      testChanges: {
        added: [],
        changed: ["src/core/a.test.ts#t"],
        removed: [],
      },
      files: {
        "src/core/a.ts": {
          source: "code",
          mutants: [
            {
              ...mutant("covered", "Survived"),
              coveredBy: ["src/core/a.test.ts#u"],
            },
            {
              ...mutant("changed", "Survived"),
              coveredBy: ["src/core/a.test.ts#t"],
            },
          ],
        },
      },
    });
    expect(crossCheckRegressions(before, after).map((f) => f.key)).toEqual([
      "changed",
    ]);
  });

  it("skips files whose source changed", () => {
    expect(
      crossCheckRegressions(
        reportOf("old", [mutant("m", "Killed")]),
        reportOf("new", [mutant("m", "Survived")]),
      ),
    ).toEqual([]);
  });

  it("fails the review with one error per mutant that mutator also reports", () => {
    const before = reportOf("code", [
      mutant("m", "Timeout"),
      mutant("n", "Killed"),
    ]);
    const after = report({
      ...base,
      findings: [
        { kind: "detectionRegression", key: "n", previousKillers: [] },
      ],
      files: {
        "src/core/a.ts": {
          source: "code",
          mutants: [mutant("m", "NoCoverage"), mutant("n", "NoCoverage")],
        },
      },
    });
    const review = reviewFindings(after, before);
    expect(review.exitCode).toBe(1);
    expect(
      review.lines.filter((line) => line.startsWith("::error")),
    ).toHaveLength(2);
    expect(review.lines.at(-1)).toBe(
      "テストが弱くなった箇所: 2件、何も検出しない新しいテスト: 0件、テストが検出できないミュータント: 0件",
    );
  });
});

describe("recheck", () => {
  const mutant = (id: string, status: string, killedBy: string[] = []) => ({
    id,
    mutatorName: "BooleanLiteral",
    replacement: "true",
    location: { start: { line: 4, column: 1 } },
    status,
    killedBy,
  });
  const changed = "src/core/a.test.ts#changed";
  const unrelated = "src/core/b.test.ts#unrelated";
  const baseReport = report({
    ...base,
    findings: [],
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("mixed", "Killed", [changed, unrelated]),
          mutant("changedOnly", "Killed", [changed]),
          mutant("unchangedOnly", "Killed", [unrelated]),
          mutant("edited", "Killed", [changed, unrelated]),
          mutant("reported", "Killed", [changed, unrelated]),
        ],
      },
    },
  });
  const current = report({
    ...base,
    findings: [{ kind: "detectionRegression", key: "reported" }],
    testChanges: { added: [], changed: [changed], removed: [] },
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("mixed", "Killed", [changed, unrelated]),
          mutant("changedOnly", "Killed", [changed]),
          mutant("unchangedOnly", "Killed", [unrelated]),
          mutant("edited", "Killed", [changed, unrelated]),
          mutant("reported", "Survived"),
        ],
      },
    },
  });
  const scopes = (edited: string) =>
    new Map([
      ["mixed", "s1"],
      ["changedOnly", "s1"],
      ["unchangedOnly", "s1"],
      ["edited", edited],
      ["reported", "s1"],
    ]);

  it("picks mutants killed by both changed and unchanged tests in an unchanged function", () => {
    expect(
      recheckCandidates(baseReport, current, scopes("s1"), scopes("s2")),
    ).toEqual(["mixed"]);
  });

  it("fails each mutant that a rerun did not detect", () => {
    const rerun = (status: string) =>
      report({
        ...base,
        findings: [],
        files: { "src/core/a.ts": { mutants: [mutant("mixed", status)] } },
      });
    expect(
      reviewRechecked(current, ["mixed"], [rerun("Killed"), rerun("Killed")]),
    ).toEqual([]);
    const lines = reviewRechecked(
      current,
      ["mixed"],
      [rerun("Killed"), rerun("Survived")],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^::error file=src\/core\/a\.ts,line=4,title=テストが弱くなった::変わっていないコードのミュータントmixed/,
    );
    expect(lines[0]).toContain("mutator acceptで通さないでください");
  });

  it("catches the regressions mutator missed by reusing a baseline kill, in reports from mutator 0.4.5", () => {
    const fixture = JSON.parse(
      readFileSync(
        new URL("./fixtures/mutator-0.4.5-reused-kill.json", import.meta.url),
        "utf8",
      ),
    );
    const current = report(fixture.current);
    expect(current.findings).toEqual([]);
    const keys = recheckCandidates(
      report(fixture.base),
      current,
      scopeHashes(fixture.baseSnapshot),
      scopeHashes(fixture.currentSnapshot),
    );
    expect(keys).toHaveLength(14);
    const lines = reviewRechecked(current, keys, [report(fixture.rerun)]);
    expect(
      lines.map((line) => /ミュータント([a-z0-9]+)/.exec(line)?.[1]),
    ).toEqual([
      "18e4gph9vjs",
      "1gfsysf9ilu",
      "1hzfnwizh8n",
      "5zuqzzf1xb",
      "d9lrij95oz",
      "kvpjevjjvc",
      "strzyhiu4g",
    ]);
  });

  it("reads scope hashes from a format 2 snapshot only", () => {
    expect(
      scopeHashes({
        format: 2,
        rows: [["k", 0, 1, "hash", "Killed"], ["bad"], "x"],
      }),
    ).toEqual(new Map([["k", "hash"]]));
    expect(scopeHashes({ format: 3, rows: [["k", 0, 1, "hash"]] })).toEqual(
      new Map(),
    );
    expect(scopeHashes(null)).toEqual(new Map());
  });
});

describe("decodeReport", () => {
  it.each([
    [[], "JSONのオブジェクトではありません。"],
    [null, "JSONのオブジェクトではありません。"],
    [
      { findings: [], files: {} },
      "schemaVersionがありません。このスクリプトは2だけを読みます。",
    ],
    [
      { schemaVersion: "3", comparison: "available", findings: [], files: {} },
      'schemaVersionが"3"です。このスクリプトは2だけを読みます。',
    ],
    [
      { schemaVersion: "2", findings: [], files: {} },
      "comparisonがありません。",
    ],
    [
      { schemaVersion: "2", comparison: "available", files: {} },
      "findingsの配列がありません。",
    ],
    [
      { schemaVersion: "2", comparison: "available", findings: [] },
      "filesのオブジェクトがありません。",
    ],
  ])("rejects %j", (value, problem) => {
    expect(decodeReport(value)).toEqual({ problem });
  });

  it("drops entries of an unknown shape", () => {
    expect(
      decodeReport({
        schemaVersion: "2",
        comparison: "available",
        findings: [{ key: "no kind" }, "text"],
        files: { "a.ts": { mutants: [{ mutatorName: "no id" }] }, "b.ts": 1 },
      }),
    ).toEqual({
      report: {
        comparison: "available",
        findings: [],
        files: new Map([
          ["a.ts", []],
          ["b.ts", []],
        ]),
        sources: new Map(),
        changedTests: [],
        removedTests: [],
      },
    });
  });
});

describe("formatAnnotation", () => {
  it("escapes separators and line breaks inside values", () => {
    expect(
      formatAnnotation({
        level: "warning",
        title: "a:b,c",
        message: "100%\r\nok",
        file: "src/a,b:c.ts",
        line: 4,
      }),
    ).toBe(
      "::warning file=src/a%2Cb%3Ac.ts,line=4,title=a%3Ab%2Cc::100%25%0D%0Aok",
    );
  });
});

describe("reviewSettingChanges", () => {
  it("warns about mutator settings at the root only", () => {
    expect(
      reviewSettingChanges([
        "src/core/tabs.ts",
        "mutator.config.json",
        "mutator.accepted.json",
        "mutator.config.ts",
        "docs/mutator.config.json",
        "docs/vitest.config.ts",
      ]),
    ).toEqual(
      ["mutator.config.json", "mutator.accepted.json", "mutator.config.ts"].map(
        (file) =>
          `::warning file=${file},title=ミューテーションテストの設定が変わった::${file}が変わりました。検査する範囲が狭まっていないか、動作の変わるミュータントを記録していないかを確かめてください。`,
      ),
    );
  });

  it("warns about the Vitest config and the setup files it names", () => {
    expect(
      reviewSettingChanges(
        ["vitest.config.ts", "test/setup.ts", "test/other.ts"],
        ["vitest.config.ts", "test/setup.ts"],
      ),
    ).toEqual(
      ["vitest.config.ts", "test/setup.ts"].map(
        (file) =>
          `::warning file=${file},title=テストの設定や準備ファイルが変わった::${file}が変わりました。テストの設定や準備ファイルは、アサーションを無力化するなど、ミューテーションテストでは見つからない形でテストを弱められます。人が確かめてください。`,
      ),
    );
  });
});
