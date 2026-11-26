import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeReport,
  formatAnnotation,
  type MutationReport,
  reviewFindings,
  reviewSettingChanges,
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
