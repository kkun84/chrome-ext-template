import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  droppedFiles,
  parseRenames,
  projectFiles,
  reviewFullRun,
  reviewScope,
} from "./mutation-scope.ts";

const root = join("/", "repo");

describe("projectFiles", () => {
  it("lists config, setup and global setup files inside the root", () => {
    expect(
      projectFiles(root, [
        {
          configFile: join(root, "vitest.config.ts"),
          setupFiles: [join(root, "test", "setup.ts")],
          globalSetup: join(root, "test", "global.ts"),
        },
        {
          configFile: join(root, "vitest.config.ts"),
          setupFiles: [],
          globalSetup: [join(root, "a-global.ts")],
        },
      ]),
    ).toEqual([
      "a-global.ts",
      "test/global.ts",
      "test/setup.ts",
      "vitest.config.ts",
    ]);
  });

  it("leaves out files outside the root, in node_modules or relative", () => {
    expect(
      projectFiles(root, [
        {
          configFile: false,
          setupFiles: [
            join("/", "elsewhere", "setup.ts"),
            join(root, "node_modules", "pkg", "setup.js"),
            "relative/setup.ts",
            root,
          ],
          globalSetup: undefined,
        },
      ]),
    ).toEqual([]);
  });
});

describe("parseRenames", () => {
  it("maps renamed paths and skips other statuses", () => {
    expect(
      parseRenames(
        [
          "M",
          "a.ts",
          "R100",
          "src/old.test.ts",
          "src/new.test.ts",
          "C075",
          "x.ts",
          "y.ts",
          "D",
          "gone.ts",
          "",
        ].join("\0"),
      ),
    ).toEqual(new Map([["src/old.test.ts", "src/new.test.ts"]]));
  });
});

describe("droppedFiles", () => {
  const exists = (present: readonly string[]) => (path: string) =>
    present.includes(path);

  it("reports a file that still exists and is no longer collected", () => {
    expect(
      droppedFiles(
        ["a.test.ts", "b.test.ts"],
        ["a.test.ts"],
        new Map(),
        exists(["a.test.ts", "b.test.ts"]),
      ),
    ).toEqual([{ file: "b.test.ts", from: "b.test.ts" }]);
  });

  it("follows renames and ignores deleted files", () => {
    expect(
      droppedFiles(
        ["old.test.ts", "gone.test.ts", "moved.test.ts"],
        ["new.test.ts"],
        new Map([
          ["old.test.ts", "new.test.ts"],
          ["moved.test.ts", "moved.test.mts"],
        ]),
        exists(["new.test.ts", "moved.test.mts"]),
      ),
    ).toEqual([{ file: "moved.test.mts", from: "moved.test.ts" }]);
  });
});

describe("reviewScope", () => {
  it("writes one error per dropped file", () => {
    const lines = reviewScope(
      [{ file: "src/a.test.mts", from: "src/a.test.ts" }],
      [{ file: "src/core/a.ts", from: "src/core/a.ts" }],
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^::error file=src\/a\.test\.mts,title=テストが集められなくなった::src\/a\.test\.mts（基準ではsrc\/a\.test\.ts）は基準では/,
    );
    expect(lines[1]).toMatch(
      /^::error file=src\/core\/a\.ts,title=ミューテーションテストの対象から外れた::src\/core\/a\.tsは基準では/,
    );
  });
});

describe("reviewFullRun", () => {
  it("fails on since and shard, which make a full run partial", () => {
    expect(reviewFullRun({}, "mutator.config.json")).toEqual([]);
    const lines = reviewFullRun(
      { since: "HEAD", shard: "1/2" },
      "mutator.config.json",
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^::error file=mutator\.config\.json,title=基準の全件を打ち切る設定がある::mutator\.config\.jsonにsinceがあります。/,
    );
    expect(lines[1]).toContain("shardがあります");
  });

  it("fails on settings that pick another test runner or config, and on sharedCache", () => {
    const lines = reviewFullRun(
      {
        runner: "vitest",
        vitestConfig: "vitest.config.alt.ts",
        jestConfig: "jest.config.js",
        playwrightConfig: "playwright.config.ts",
        sharedCache: false,
      },
      "mutator.config.json",
    );
    expect(
      lines.map((line) =>
        /title=([^:]+)::mutator\.config\.jsonに(\w+)があります/
          .exec(line)
          ?.slice(1),
      ),
    ).toEqual(
      [
        "runner",
        "vitestConfig",
        "jestConfig",
        "playwrightConfig",
        "sharedCache",
      ].map((key) => ["判定で使えない設定がある", key]),
    );
    expect(lines[1]).toContain("別のテストランナーか設定でテストを集めます");
    expect(lines[4]).toContain(".git/mutator/");
  });
});
