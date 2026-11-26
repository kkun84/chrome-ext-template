import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decodeReport,
  formatAnnotation,
  type MutationReport,
  mergeDeps,
  reviewFindings,
  reviewNotRun,
  reviewPending,
  reviewSettingChanges,
  reviewSettingDrops,
  reviewSkippedTests,
  reviewUnselected,
  scopeHashes,
  snapshotDeps,
  touchedTests,
  unselectedCandidates,
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

  it("warns about a changed test file the runner does not collect", () => {
    expect(
      reviewFindings(
        report({
          ...base,
          findings: [],
          warnings: [
            {
              kind: "uncollectedTest",
              file: "src/core/a.test.mts",
              message: "m",
            },
            { kind: "childProcessTest", test: "t", command: "c" },
          ],
        }),
      ).lines[0],
    ).toMatch(
      /^::warning file=src\/core\/a\.test\.mts,title=拾われないテストファイル::/,
    );
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

describe("unselected mutants", () => {
  const mutant = (id: string, status: string, killedBy: string[] = []) => ({
    id,
    mutatorName: "Regex",
    replacement: "/a/",
    location: { start: { line: 4, column: 1 } },
    status,
    killedBy,
  });
  const changed = "src/core/a.test.ts#changed";
  const other = "src/core/b.test.ts#other";
  const baseReport = report({
    ...base,
    findings: [],
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("moduleLevel", "Killed", [changed]),
          mutant("missing", "Killed", [changed]),
          mutant("ran", "Killed", [changed]),
          mutant("otherKiller", "Killed", [other]),
          mutant("edited", "Killed", [changed]),
          mutant("timeout", "Timeout"),
        ],
      },
    },
  });
  const current = report({
    ...base,
    findings: [],
    testChanges: { added: [], changed: [changed], removed: [] },
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("moduleLevel", "Pending"),
          mutant("ran", "Killed", [changed]),
          mutant("otherKiller", "Pending"),
          mutant("edited", "Pending"),
          mutant("timeout", "Pending"),
        ],
      },
    },
  });
  const scopes = (edited: string) =>
    new Map([
      ["moduleLevel", "s"],
      ["missing", "s"],
      ["ran", "s"],
      ["otherKiller", "s"],
      ["edited", edited],
      ["timeout", "s"],
    ]);

  it("picks unchanged mutants a touched test killed at the base and this run did not decide", () => {
    expect(
      unselectedCandidates(
        baseReport,
        current,
        scopes("s"),
        scopes("t"),
        (test) => test === changed,
      ),
    ).toEqual(["missing", "moduleLevel"]);
  });

  it("picks nothing when no test was touched", () => {
    expect(
      unselectedCandidates(
        baseReport,
        current,
        scopes("s"),
        scopes("t"),
        () => false,
      ),
    ).toEqual([]);
  });

  it("fails each mutant no test detects now, or whose status is unexpected", () => {
    const rerun = report({
      ...base,
      findings: [],
      files: {
        "src/core/a.ts": {
          mutants: [
            mutant("moduleLevel", "Survived"),
            mutant("missing", "Killed", [other]),
            mutant("odd", "RuntimeError"),
          ],
        },
      },
    });
    const lines = reviewUnselected(
      baseReport,
      ["moduleLevel", "missing", "odd", "absent"],
      rerun,
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(
      /^::error file=src\/core\/a\.ts,line=4,title=テストが弱くなった::変わっていないコードのミュータントmoduleLevel/,
    );
    expect(lines[0]).toContain("mutator acceptで通さないでください");
    expect(lines[1]).toMatch(
      /title=ミュータントの結果が想定と違う::.*RuntimeError/,
    );
    expect(lines[2]).toMatch(
      /title=ミュータントの結果が想定と違う::.*ありません/,
    );
  });

  it("fails when a run left a mutant Pending", () => {
    expect(reviewPending(baseReport, "基準の全件の実行")).toEqual([]);
    const lines = reviewPending(current, "基準の全件の実行");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^::error title=実行されなかったミュータントがある::基準の全件の実行で、ミュータント4件（edited、moduleLevel、otherKiller、timeout）が実行されずに/,
    );
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

describe("touchedTests", () => {
  const named = report({
    ...base,
    findings: [],
    testChanges: {
      added: ["src/new.test.ts#added"],
      changed: ["src/a.test.ts#changed"],
      removed: ["src/a.test.ts#removed"],
    },
    selectionReasons: [
      { key: "k", reason: "changedTest", tests: ["src/s.test.ts#selected"] },
      { key: "j", tests: "not a list" },
    ],
  });
  const deps = new Map([
    ["src/h.test.ts", ["src/core/helper.ts", "src/core/a.ts"]],
    ["src/u.test.ts", ["src/core/a.ts"]],
  ]);
  const touched = touchedTests(
    named,
    new Set(["src/core/helper.ts", "src/f.test.ts"]),
    deps,
  );

  it("counts the tests mutator changed, removed or selected for", () => {
    expect(named.selectedTests).toEqual(["src/s.test.ts#selected"]);
    expect(touched("src/a.test.ts#changed")).toBe(true);
    expect(touched("src/a.test.ts#removed")).toBe(true);
    expect(touched("src/s.test.ts#selected")).toBe(true);
    expect(touched("src/new.test.ts#added")).toBe(false);
  });

  it("counts a test whose file or a file it loads changed", () => {
    expect(touched("src/f.test.ts#any")).toBe(true);
    expect(touched("src/h.test.ts#uses the helper")).toBe(true);
    expect(touched("src/u.test.ts#does not")).toBe(false);
  });

  it("reads deps from a format 2 snapshot and merges them", () => {
    expect(
      snapshotDeps({
        format: 2,
        deps: { "a.test.ts": ["a.ts", 1], "b.test.ts": "x" },
      }),
    ).toEqual(
      new Map([
        ["a.test.ts", ["a.ts"]],
        ["b.test.ts", []],
      ]),
    );
    expect(
      snapshotDeps({ format: 3, deps: { "a.test.ts": ["a.ts"] } }),
    ).toEqual(new Map());
    expect(
      mergeDeps(
        new Map([["a.test.ts", ["b.ts", "a.ts"]]]),
        new Map([
          ["a.test.ts", ["c.ts", "a.ts"]],
          ["d.test.ts", ["d.ts"]],
        ]),
      ),
    ).toEqual(
      new Map([
        ["a.test.ts", ["a.ts", "b.ts", "c.ts"]],
        ["d.test.ts", ["d.ts"]],
      ]),
    );
  });
});

describe("reviewSettingDrops", () => {
  const mutant = (id: string, status: string, killedBy: string[] = []) => ({
    id,
    mutatorName: "Regex",
    replacement: "/a/",
    location: { start: { line: 4, column: 1 } },
    status,
    killedBy,
  });
  const touched = "src/a.test.ts#touched";
  const other = "src/b.test.ts#other";
  const own = report({
    ...base,
    findings: [],
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("excluded", "Killed", [touched, other]),
          mutant("weakened", "Killed", [touched]),
          mutant("kept", "Killed", [touched]),
          mutant("unrelated", "Killed", [other]),
          mutant("survived", "Survived"),
        ],
      },
    },
  });
  const now = report({
    ...base,
    findings: [],
    files: {
      "src/core/a.ts": {
        mutants: [
          mutant("weakened", "Survived"),
          mutant("kept", "Killed", [touched]),
        ],
      },
    },
  });

  it("fails on a mutant the new settings drop while a touched test killed it", () => {
    const lines = reviewSettingDrops(own, now, (test) => test === touched);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^::error file=src\/core\/a\.ts,line=4,title=設定の変更で、変えたテストが確かめるミュータントが外れた::ミュータントexcluded（Regexで\/a\/に置き換え）は、基準の元の設定では「src\/a\.test\.ts#touched」が検出していましたが、今のmutatorの設定では作られません。/,
    );
    expect(lines[1]).toContain("今のmutatorの設定ではSurvivedになります");
  });

  it("leaves the mutants of untouched tests to the warning about the settings", () => {
    expect(reviewSettingDrops(own, now, () => false)).toEqual([]);
  });
});

describe("mutator's text output", () => {
  it("warns about a test the change skips", () => {
    expect(
      reviewSkippedTests(
        "x\nwarning: src/core/a.test.ts:12 skips a test in the change, so it checks nothing: a skipped test\n",
      ),
    ).toEqual([
      "::warning file=src/core/a.test.ts,line=12,title=飛ばしたテスト::変更の中でテストを飛ばしています（a skipped test）。飛ばしたテストは何も確かめません。",
    ]);
  });

  it("fails when mutants of the diff were not run", () => {
    expect(reviewNotRun("Killed 3 · Survived 1\nscore")).toEqual([]);
    expect(reviewNotRun("Killed 3 · Pending 2\n")[0]).toMatch(
      /^::error title=変更の範囲のミュータントが実行されなかった::.*Killed 3 · Pending 2/,
    );
    expect(
      reviewNotRun("not run: 4 over the time budget (--time-budget)\n"),
    ).toHaveLength(1);
    expect(
      reviewNotRun("Killed 4 · Survived 3 (1 not infected) · Pending 2\n")[0],
    ).toMatch(/Survived 3 \(1 not infected\) · Pending 2/);
    expect(reviewNotRun("Killed 4 · Survived 3 (1 not infected)\n")).toEqual(
      [],
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
        changedTests: [],
        removedTests: [],
        selectedTests: [],
        uncollected: [],
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

  it("warns about the review, package.json, lefthook.yml and the workflows", () => {
    expect(
      reviewSettingChanges([
        "scripts/mutation-diff.sh",
        "scripts/mutation-scope.ts",
        "scripts/check-mutation-findings.ts",
        "package.json",
        "lefthook.yml",
        ".github/workflows/ci.yml",
        "scripts/lint-ja-space.ts",
        "scripts/mutation-scope.test.ts",
        "src/package.json",
      ]).map((line) => /file=([^,]+)/.exec(line)?.[1]),
    ).toEqual([
      "scripts/mutation-diff.sh",
      "scripts/mutation-scope.ts",
      "scripts/check-mutation-findings.ts",
      "package.json",
      "lefthook.yml",
      ".github/workflows/ci.yml",
    ]);
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
