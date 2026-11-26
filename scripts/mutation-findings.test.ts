import { describe, expect, it } from "vitest";
import {
  decodeReport,
  formatAnnotation,
  type MutationReport,
  reviewFindings,
  reviewSettingChanges,
} from "./mutation-findings.ts";

const REGRESSION_ADVICE =
  "今はどのテストも検出しません。弱めたアサーションや消したテストを戻すか、同じ振る舞いを確かめるテストを足してください。";

const report = (value: unknown): MutationReport => {
  const decoded = decodeReport(value);
  if (decoded === undefined) {
    throw new Error("fixture is not a report");
  }
  return decoded;
};

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

describe("reviewFindings", () => {
  it("fails with an error on the mutant's line for a detection regression", () => {
    const review = reviewFindings(
      report({
        comparison: "available",
        findings: [
          { kind: "mutationGap", severity: "warning", key: "other" },
          {
            kind: "detectionRegression",
            severity: "warning",
            key: "weak",
            previousKillers: [
              "src/core/tabs.test.ts#a",
              "src/core/tabs.test.ts#b",
            ],
          },
        ],
        files,
      }),
      "mutation.json",
    );
    expect(review).toEqual({
      lines: [
        `::error file=src/core/tabs.ts,line=12,title=テストが弱くなった::変わっていないコードのミュータントweak（EqualityOperatorでa === bに置き換え）を、前は「src/core/tabs.test.ts#a」、「src/core/tabs.test.ts#b」が検出していましたが、${REGRESSION_ADVICE}`,
        "テストが弱くなった箇所: 1件、何も検出しない新しいテスト: 0件",
        "テストが検出できなかったミュータント: 1件。テストが足りないのか、コードが要らないのかを見直してください。手順はnode_modules/@mizchi/mutator/skills/mutation-test-loop/SKILL.mdにあります。",
      ],
      exitCode: 1,
    });
  });

  it("fails without a file or line when the mutant cannot be located", () => {
    const review = reviewFindings(
      report({
        findings: [
          { kind: "detectionRegression", key: "gone", previousKillers: [] },
          { kind: "detectionRegression", key: "bare" },
        ],
        files: { "src/core/url.ts": { mutants: [{ id: "bare" }] } },
      }),
      "mutation.json",
    );
    expect(review.lines.slice(0, 2)).toEqual([
      `::error title=テストが弱くなった::変わっていないコードのミュータントgoneを、前はテストが検出していましたが、${REGRESSION_ADVICE}`,
      `::error file=src/core/url.ts,title=テストが弱くなった::変わっていないコードのミュータントbareを、前はテストが検出していましたが、${REGRESSION_ADVICE}`,
    ]);
    expect(review.exitCode).toBe(1);
  });

  it("only warns about a new test that detects nothing", () => {
    expect(
      reviewFindings(
        report({
          comparison: "available",
          findings: [
            {
              kind: "newTestNoKills",
              test: "src/core/tabs.test.ts#calls only",
              measured: 3,
            },
            { kind: "testNotMeasured", test: "src/core/tabs.test.ts#other" },
          ],
          files,
        }),
        "mutation.json",
      ),
    ).toEqual({
      lines: [
        "::warning title=何も検出しない新しいテスト::src/core/tabs.test.ts#calls onlyは、測ったミュータントを1つも検出しません。アサーションを確かめてください。",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 1件",
      ],
      exitCode: 0,
    });
  });

  it("passes with a notice when there was nothing to compare with", () => {
    expect(
      reviewFindings(
        report({ comparison: "unavailable", findings: [] }),
        "mutation.json",
      ),
    ).toEqual({
      lines: [
        "::notice title=比較の基準が無い::前回の結果が無いか、依存、ロックファイル、tsconfig.json、Node.jsの版、mutatorの設定のどれかが変わったため、テストが弱くなったかは確かめていません。",
        "テストが弱くなった箇所: 0件、何も検出しない新しいテスト: 0件",
      ],
      exitCode: 0,
    });
  });

  it("fails when the report is missing", () => {
    expect(reviewFindings(undefined, ".mutator/report/mutation.json")).toEqual({
      lines: [
        "::error title=ミューテーションテストの結果が無い::.mutator/report/mutation.jsonがありません。先にmutatorをjsonのreporterで実行してください。",
      ],
      exitCode: 1,
    });
  });
});

describe("decodeReport", () => {
  it("rejects a value that is not an object", () => {
    expect(decodeReport([])).toBeUndefined();
    expect(decodeReport(null)).toBeUndefined();
  });

  it("drops entries of an unknown shape", () => {
    expect(
      decodeReport({
        comparison: 1,
        findings: [{ key: "no kind" }, "text"],
        files: { "a.ts": { mutants: [{ mutatorName: "no id" }] }, "b.ts": 1 },
      }),
    ).toEqual({
      findings: [],
      files: new Map([
        ["a.ts", []],
        ["b.ts", []],
      ]),
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
        "vitest.config.ts",
      ]),
    ).toEqual(
      ["mutator.config.json", "mutator.accepted.json", "mutator.config.ts"].map(
        (file) =>
          `::warning file=${file},title=ミューテーションテストの設定が変わった::${file}が変わりました。検査する範囲が狭まっていないか、動作の変わるミュータントを記録していないかを確かめてください。`,
      ),
    );
  });
});
