import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkRepo,
  findForbiddenKeysInNpmrc,
  findForbiddenKeysInYaml,
  forbiddenOptionTokens,
  parseYaml,
} from "./pnpm-policy.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pnpm-policy-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content: string): string => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
};

const VALID_WORKSPACE = [
  "minimumReleaseAge: 10080",
  "trustPolicy: no-downgrade",
  "onlyBuiltDependencies: []",
  "blockExoticSubdeps: true",
  "",
].join("\n");

const workspaceWith = (extra: string): string => `${VALID_WORKSPACE}${extra}\n`;

const messages = (): string[] => checkRepo(root).map((f) => f.message);

describe("parseYaml", () => {
  it("parses scalars, comments, empty arrays and booleans", () => {
    const map = parseYaml(
      [
        "# a comment",
        "minimumReleaseAge: 10080",
        "trustPolicy: no-downgrade",
        "onlyBuiltDependencies: []",
        "blockExoticSubdeps: true",
        "",
      ].join("\n"),
    );
    expect(map.get("minimumReleaseAge")).toBe(10080);
    expect(map.get("trustPolicy")).toBe("no-downgrade");
    expect(map.get("onlyBuiltDependencies")).toEqual([]);
    expect(map.get("blockExoticSubdeps")).toBe(true);
  });

  it("parses indented sequences and quoted values", () => {
    const map = parseYaml(
      [
        "onlyBuiltDependencies:",
        "  - lefthook",
        "  - esbuild",
        'name: "日本語"',
        "",
      ].join("\n"),
    );
    expect(map.get("onlyBuiltDependencies")).toEqual(["lefthook", "esbuild"]);
    expect(map.get("name")).toBe("日本語");
  });

  it("ignores a key that only appears in a comment", () => {
    const map = parseYaml("# minimumReleaseAgeExclude: []\nvalue: 1\n");
    expect(map.has("minimumReleaseAgeExclude")).toBe(false);
    expect(map.get("value")).toBe(1);
  });
});

describe("findForbiddenKeysInYaml", () => {
  it("flags an actual forbidden key", () => {
    const key = "minimumReleaseAgeExclude";
    const findings = findForbiddenKeysInYaml(`${key}: []\n`);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBe(1);
  });

  it("does not flag a comment that mentions the name", () => {
    const key = "minimumReleaseAgeExclude";
    expect(findForbiddenKeysInYaml(`# ${key} is not allowed\n`)).toHaveLength(
      0,
    );
  });

  it("flags the kebab-case variant", () => {
    const key = "trust-policy-exclude";
    expect(findForbiddenKeysInYaml(`${key}: []\n`)).toHaveLength(1);
  });
});

describe("findForbiddenKeysInNpmrc", () => {
  it("flags a forbidden key and ignores comments", () => {
    const key = "minimum-release-age-exclude";
    expect(findForbiddenKeysInNpmrc(`${key}=true\n`)).toHaveLength(1);
    expect(findForbiddenKeysInNpmrc(`# ${key}=true\n`)).toHaveLength(0);
  });
});

describe("checkRepo required settings", () => {
  it("passes for the valid workspace shape", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    expect(checkRepo(root)).toHaveLength(0);
  });

  it("fails when a forbidden key is added and passes once removed", () => {
    const key = "minimumReleaseAgeExclude";
    write("pnpm-workspace.yaml", workspaceWith(`${key}:\n  - foo`));
    expect(messages().some((m) => m.includes(key))).toBe(true);
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    expect(checkRepo(root)).toHaveLength(0);
  });

  it("fails for minimumReleaseAge below the gate", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE.replace("10080", "10079"));
    expect(messages().some((m) => m.includes("minimumReleaseAge"))).toBe(true);
  });

  it('accepts 10080, 20000 and the string "10080"', () => {
    for (const value of ["10080", "20000", '"10080"']) {
      write(
        "pnpm-workspace.yaml",
        VALID_WORKSPACE.replace(
          "minimumReleaseAge: 10080",
          `minimumReleaseAge: ${value}`,
        ),
      );
      expect(checkRepo(root)).toHaveLength(0);
    }
  });

  it("fails when trustPolicy is missing or wrong", () => {
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace("trustPolicy: no-downgrade\n", ""),
    );
    expect(messages().some((m) => m.includes("trustPolicy"))).toBe(true);
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace("no-downgrade", "allow-downgrade"),
    );
    expect(messages().some((m) => m.includes("trustPolicy"))).toBe(true);
  });

  it("fails when onlyBuiltDependencies is non-empty or missing", () => {
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace(
        "onlyBuiltDependencies: []",
        'onlyBuiltDependencies: ["lefthook"]',
      ),
    );
    expect(messages().some((m) => m.includes("onlyBuiltDependencies"))).toBe(
      true,
    );
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace("onlyBuiltDependencies: []\n", ""),
    );
    expect(messages().some((m) => m.includes("onlyBuiltDependencies"))).toBe(
      true,
    );
  });

  it("fails when blockExoticSubdeps is false or missing", () => {
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace(
        "blockExoticSubdeps: true",
        "blockExoticSubdeps: false",
      ),
    );
    expect(messages().some((m) => m.includes("blockExoticSubdeps"))).toBe(true);
    write(
      "pnpm-workspace.yaml",
      VALID_WORKSPACE.replace("blockExoticSubdeps: true\n", ""),
    );
    expect(messages().some((m) => m.includes("blockExoticSubdeps"))).toBe(true);
  });

  it("fails when package.json loosens a setting", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    write("package.json", JSON.stringify({ pnpm: { minimumReleaseAge: 1 } }));
    expect(messages().some((m) => m.includes("minimumReleaseAge"))).toBe(true);
  });
});

describe("checkRepo forbidden keys and options", () => {
  it("fails when package.json pnpm holds a forbidden key", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const key = "trustPolicyExclude";
    write("package.json", JSON.stringify({ pnpm: { [key]: [] } }));
    expect(messages().some((m) => m.includes(key))).toBe(true);
  });

  it("fails when package.json pnpm holds the ignore-after key", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const key = "trustPolicyIgnoreAfter";
    write("package.json", JSON.stringify({ pnpm: { [key]: "1" } }));
    expect(messages().some((m) => m.includes(key))).toBe(true);
  });

  it("fails for a forbidden script option and passes for safe ones", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const flag = ["--trust-policy", "exclude"].join("-");
    write(
      "package.json",
      JSON.stringify({ scripts: { install: `pnpm install ${flag}` } }),
    );
    expect(messages().some((m) => m.includes(flag))).toBe(true);

    write(
      "package.json",
      JSON.stringify({
        scripts: {
          install: "pnpm install --frozen-lockfile --trust-policy no-downgrade",
        },
        pnpm: {},
      }),
    );
    expect(checkRepo(root)).toHaveLength(0);
  });

  it("fails for forbidden options in workflows, hooks and scripts", () => {
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    const ignoreAfter = ["--trust-policy", "ignore", "after"].join("-");
    const ageExclude = ["--minimum-release-age", "exclude"].join("-");
    write(".github/workflows/ci.yml", `run: pnpm ${ignoreAfter}\n`);
    write("lefthook.yml", `run: pnpm ${ageExclude}\n`);
    write("scripts/deploy.sh", `pnpm ${ignoreAfter}\n`);
    const all = messages();
    expect(all.some((m) => m.includes(ignoreAfter))).toBe(true);
    expect(all.some((m) => m.includes(ageExclude))).toBe(true);
  });

  it("exposes config-style camelCase tokens", () => {
    const camelFlag = `--config.${"minimumReleaseAge" + "Exclude"}`;
    expect(forbiddenOptionTokens()).toContain(camelFlag);
    write("pnpm-workspace.yaml", VALID_WORKSPACE);
    write("package.json", JSON.stringify({ scripts: { x: camelFlag } }));
    expect(messages().some((m) => m.includes(camelFlag))).toBe(true);
  });
});
