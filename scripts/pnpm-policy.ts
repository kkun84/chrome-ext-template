/**
 * Pure library that checks the repository's pnpm supply-chain policy.
 *
 * It flags three things:
 * - forbidden exclude / ignore keys in `pnpm-workspace.yaml`, the `"pnpm"`
 *   object in `package.json`, and `.npmrc`;
 * - required settings that are missing or have been loosened;
 * - forbidden command-line options in scripts, workflows and hook config.
 *
 * The CLI shell is `lint-pnpm-policy.ts`. Search needles for the forbidden
 * options are assembled from split parts so this file never contains a complete
 * forbidden token, which lets the checker safely scan its own directory.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { collectFiles, lineColumnAt } from "./lint-files.ts";

/** A single policy finding. `line`/`column` are null when not meaningful. */
export interface Finding {
  readonly file: string;
  readonly line: number | null;
  readonly column: number | null;
  readonly message: string;
}

/* -------------------------------------------------------------------------- */
/* Small YAML reader                                                          */
/* -------------------------------------------------------------------------- */

/** A scalar YAML value. */
export type YamlScalar = string | number | boolean | null;
/** A parsed YAML value: scalar, sequence or mapping. */
export type YamlValue =
  | YamlScalar
  | readonly YamlValue[]
  | ReadonlyMap<string, YamlValue>;

interface YamlLine {
  readonly indent: number;
  readonly content: string;
}

/** Index just past a quoted run starting at `from` (quote char at `from`). */
const quoteEnd = (raw: string, from: number, quote: string): number => {
  let i = from + 1;
  while (i < raw.length) {
    if (quote === '"' && raw[i] === "\\") {
      i += 2;
      continue;
    }
    if (raw[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return raw.length;
};

/** Remove a trailing `#` comment, respecting single and double quotes. */
const stripYamlComment = (raw: string): string => {
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '"' || ch === "'") {
      i = quoteEnd(raw, i, ch);
      continue;
    }
    if (ch === "#" && (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")) {
      return raw.slice(0, i);
    }
    i += 1;
  }
  return raw;
};

const toYamlLines = (source: string): YamlLine[] => {
  const result: YamlLine[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const content = stripYamlComment(raw).replace(/\s+$/, "");
    const trimmed = content.trimStart();
    if (trimmed === "") {
      continue;
    }
    result.push({ indent: content.length - trimmed.length, content: trimmed });
  }
  return result;
};

/** Index of the `:` separating a key from its value, or -1. */
const findKeyColon = (content: string): number => {
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'") {
      i = quoteEnd(content, i, ch);
      continue;
    }
    if (ch === ":") {
      return i;
    }
    i += 1;
  }
  return -1;
};

const isQuoted = (text: string): boolean =>
  text.length >= 2 &&
  ((text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'")));

const unquote = (text: string): string => {
  const trimmed = text.trim();
  return isQuoted(trimmed) ? trimmed.slice(1, -1) : trimmed;
};

const parseScalar = (text: string): YamlScalar => {
  const trimmed = text.trim();
  if (isQuoted(trimmed)) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  if (trimmed === "null" || trimmed === "~") {
    return null;
  }
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
};

const parseInline = (text: string): YamlValue => {
  if (text === "{}") {
    return new Map<string, YamlValue>();
  }
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") {
      return [];
    }
    return inner.split(",").map((part) => parseScalar(part));
  }
  return parseScalar(text);
};

const parseList = (
  lines: readonly YamlLine[],
  start: number,
  indent: number,
): [YamlValue[], number] => {
  const items: YamlValue[] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined || line.indent < indent) {
      break;
    }
    if (line.indent > indent || !line.content.startsWith("-")) {
      i += 1;
      continue;
    }
    const rest = line.content.slice(1).trim();
    items.push(rest === "" ? null : parseInline(rest));
    i += 1;
  }
  return [items, i];
};

const parseEntryValue = (
  lines: readonly YamlLine[],
  start: number,
  indent: number,
  rest: string,
): [YamlValue, number] => {
  if (rest !== "") {
    return [parseInline(rest), start];
  }
  const child = lines[start];
  if (child === undefined || child.indent <= indent) {
    return [null, start];
  }
  if (child.content.startsWith("-")) {
    return parseList(lines, start, child.indent);
  }
  return parseBlock(lines, start, child.indent);
};

const parseBlock = (
  lines: readonly YamlLine[],
  start: number,
  indent: number,
): [Map<string, YamlValue>, number] => {
  const map = new Map<string, YamlValue>();
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined || line.indent < indent) {
      break;
    }
    if (line.indent > indent || line.content.startsWith("-")) {
      i += 1;
      continue;
    }
    const colon = findKeyColon(line.content);
    if (colon < 0) {
      i += 1;
      continue;
    }
    const key = unquote(line.content.slice(0, colon));
    const rest = line.content.slice(colon + 1).trim();
    const [value, next] = parseEntryValue(lines, i + 1, indent, rest);
    map.set(key, value);
    i = next;
  }
  return [map, i];
};

/**
 * Parse a small YAML document into top-level mappings. It understands comments,
 * quoted keys/values, booleans, integers, inline `[]` sequences and indented
 * `- item` sequences. It is not a general-purpose YAML parser.
 */
export const parseYaml = (source: string): ReadonlyMap<string, YamlValue> => {
  const [map] = parseBlock(toYamlLines(source), 0, 0);
  return map;
};

/* -------------------------------------------------------------------------- */
/* Forbidden keys and options                                                 */
/* -------------------------------------------------------------------------- */

const FORBIDDEN_KEYS: readonly string[] = [
  "minimumReleaseAgeExclude",
  "minimum-release-age-exclude",
  "trustPolicyExclude",
  "trust-policy-exclude",
  "trustPolicyIgnoreAfter",
  "trust-policy-ignore-after",
];

const joinKebab = (...parts: readonly string[]): string => parts.join("-");

const camel = (...parts: readonly string[]): string => parts.join("");

/**
 * Forbidden command-line options, assembled from split parts at runtime.
 *
 * The complete token never appears in this source file, so the checker can
 * scan `scripts/**` without flagging itself.
 */
export const forbiddenOptionTokens = (): readonly string[] => [
  `--${joinKebab("trust", "policy", "exclude")}`,
  `--${joinKebab("trust", "policy", "ignore", "after")}`,
  `--${joinKebab("minimum", "release", "age", "exclude")}`,
  `--config.${camel("minimum", "Release", "Age", "Exclude")}`,
  `--config.${joinKebab("minimum", "release", "age", "exclude")}`,
  `--config.${camel("trust", "Policy", "Exclude")}`,
  `--config.${joinKebab("trust", "policy", "exclude")}`,
  `--config.${camel("trust", "Policy", "Ignore", "After")}`,
  `--config.${joinKebab("trust", "policy", "ignore", "after")}`,
];

/** True when a YAML key is one of the forbidden exclude / ignore keys. */
const isForbiddenKey = (key: string): boolean => FORBIDDEN_KEYS.includes(key);

/** Find forbidden exclude / ignore keys in a YAML document. */
export const findForbiddenKeysInYaml = (
  content: string,
  file = "pnpm-workspace.yaml",
): Finding[] => {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripYamlComment(lines[i] ?? "");
    const match = /^\s*(?:"([^"]+)"|'([^']+)'|([^:\s][^:]*?))\s*:/.exec(line);
    const key = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
    if (key !== "" && isForbiddenKey(key)) {
      findings.push({
        file,
        line: i + 1,
        column: line.indexOf(key) + 1,
        message: `forbidden pnpm key "${key}": exclude / ignore lists bypass the supply-chain policy`,
      });
    }
  }
  return findings;
};

const stripNpmrcComment = (raw: string): string => {
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (
      (ch === "#" || ch === ";") &&
      (i === 0 || raw[i - 1] === " " || raw[i - 1] === "\t")
    ) {
      return raw.slice(0, i);
    }
  }
  return raw;
};

/** Find forbidden exclude / ignore keys in an `.npmrc` file. */
export const findForbiddenKeysInNpmrc = (
  content: string,
  file = ".npmrc",
): Finding[] => {
  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = stripNpmrcComment(lines[i] ?? "");
    const match = /^\s*([A-Za-z0-9._-]+?)(?:\[\])?\s*=/.exec(line);
    const key = match?.[1];
    if (key !== undefined && isForbiddenKey(key)) {
      findings.push({
        file,
        line: i + 1,
        column: line.indexOf(key) + 1,
        message: `forbidden pnpm key "${key}" in .npmrc`,
      });
    }
  }
  return findings;
};

const readPnpmObject = (
  content: string,
): ReadonlyMap<string, unknown> | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const pnpm = (parsed as Record<string, unknown>)["pnpm"];
  if (pnpm === null || typeof pnpm !== "object" || Array.isArray(pnpm)) {
    return null;
  }
  return new Map(Object.entries(pnpm as Record<string, unknown>));
};

/** Find forbidden keys in the `"pnpm"` object of a `package.json`. */
const findForbiddenKeysInPnpmObject = (
  entries: ReadonlyMap<string, unknown>,
  file = "package.json",
): Finding[] => {
  const findings: Finding[] = [];
  for (const key of entries.keys()) {
    if (isForbiddenKey(key)) {
      findings.push({
        file,
        line: null,
        column: null,
        message: `forbidden pnpm key "${key}" in package.json "pnpm"`,
      });
    }
  }
  return findings;
};

/* -------------------------------------------------------------------------- */
/* Required settings                                                          */
/* -------------------------------------------------------------------------- */

interface SettingSource {
  readonly file: string;
  readonly entries: ReadonlyMap<string, unknown>;
}

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
};

const isMinimumReleaseAge = (value: unknown): boolean => {
  const age = toNumber(value);
  return age !== null && age >= 10080;
};

const isNoDowngrade = (value: unknown): boolean => value === "no-downgrade";

const isEmptyArray = (value: unknown): boolean =>
  Array.isArray(value) && value.length === 0;

const isTrue = (value: unknown): boolean => value === true;

interface RequiredSetting {
  readonly names: readonly string[];
  readonly requirement: string;
  readonly valid: (value: unknown) => boolean;
}

const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  {
    names: ["minimumReleaseAge", "minimum-release-age"],
    requirement: "a number >= 10080",
    valid: isMinimumReleaseAge,
  },
  {
    names: ["trustPolicy", "trust-policy"],
    requirement: '"no-downgrade"',
    valid: isNoDowngrade,
  },
  {
    names: ["onlyBuiltDependencies", "only-built-dependencies"],
    requirement: "an empty array",
    valid: isEmptyArray,
  },
  {
    names: ["blockExoticSubdeps", "block-exotic-subdeps"],
    requirement: "true",
    valid: isTrue,
  },
];

const settingSources = (
  workspaceYaml: string | null,
  packageJson: string | null,
): SettingSource[] => {
  const sources: SettingSource[] = [];
  if (workspaceYaml !== null) {
    sources.push({
      file: "pnpm-workspace.yaml",
      entries: parseYaml(workspaceYaml),
    });
  }
  const pnpm = packageJson === null ? null : readPnpmObject(packageJson);
  if (pnpm !== null) {
    sources.push({ file: "package.json", entries: pnpm });
  }
  return sources;
};

interface PresentSetting {
  readonly file: string;
  readonly name: string;
  readonly value: unknown;
}

const collectPresentSettings = (
  sources: readonly SettingSource[],
  setting: RequiredSetting,
): PresentSetting[] => {
  const present: PresentSetting[] = [];
  for (const source of sources) {
    for (const name of setting.names) {
      if (source.entries.has(name)) {
        present.push({
          file: source.file,
          name,
          value: source.entries.get(name),
        });
      }
    }
  }
  return present;
};

const checkOneSetting = (
  sources: readonly SettingSource[],
  setting: RequiredSetting,
): Finding[] => {
  const present = collectPresentSettings(sources, setting);
  if (present.length === 0) {
    return [
      {
        file: "pnpm-workspace.yaml",
        line: null,
        column: null,
        message: `required pnpm setting "${setting.names[0]}" is missing; expected ${setting.requirement}`,
      },
    ];
  }
  return present
    .filter((item) => !setting.valid(item.value))
    .map((item) => ({
      file: item.file,
      line: null,
      column: null,
      message: `pnpm setting "${item.name}" must be ${setting.requirement}`,
    }));
};

/**
 * Verify the required settings across every source. A missing key everywhere is
 * a failure; if a key is present in more than one file, every present value must
 * be acceptable.
 */
const checkRequiredSettings = (sources: readonly SettingSource[]): Finding[] =>
  REQUIRED_SETTINGS.flatMap((setting) => checkOneSetting(sources, setting));

/* -------------------------------------------------------------------------- */
/* Token scanning                                                             */
/* -------------------------------------------------------------------------- */

const tokenFindings = (
  file: string,
  content: string,
  tokens: readonly string[],
): Finding[] => {
  const findings: Finding[] = [];
  for (const token of tokens) {
    let index = content.indexOf(token);
    while (index >= 0) {
      const { line, column } = lineColumnAt(content, index);
      findings.push({
        file,
        line,
        column,
        message: `forbidden pnpm command-line option "${token}"`,
      });
      index = content.indexOf(token, index + token.length);
    }
  }
  return findings;
};

const readIfExists = (path: string): string | null => {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
};

const scanWorkflows = (root: string, tokens: readonly string[]): Finding[] => {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    if (!entry.name.endsWith(".yml") && !entry.name.endsWith(".yaml")) {
      continue;
    }
    const path = join(dir, entry.name);
    findings.push(
      ...tokenFindings(
        relative(root, path),
        readFileSync(path, "utf8"),
        tokens,
      ),
    );
  }
  return findings;
};

const scanScripts = (root: string, tokens: readonly string[]): Finding[] => {
  const dir = join(root, "scripts");
  if (!existsSync(dir)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const path of collectFiles([dir])) {
    findings.push(
      ...tokenFindings(
        relative(root, path),
        readFileSync(path, "utf8"),
        tokens,
      ),
    );
  }
  return findings;
};

/* -------------------------------------------------------------------------- */
/* Repository check                                                           */
/* -------------------------------------------------------------------------- */

/** Check every policy file under `root` and return all findings. */
export const checkRepo = (root: string): Finding[] => {
  const workspaceYaml = readIfExists(join(root, "pnpm-workspace.yaml"));
  const packageJson = readIfExists(join(root, "package.json"));
  const npmrc = readIfExists(join(root, ".npmrc"));

  const findings: Finding[] = [];
  if (workspaceYaml !== null) {
    findings.push(...findForbiddenKeysInYaml(workspaceYaml));
  }
  const pnpmObject = packageJson === null ? null : readPnpmObject(packageJson);
  if (pnpmObject !== null) {
    findings.push(...findForbiddenKeysInPnpmObject(pnpmObject));
  }
  if (npmrc !== null) {
    findings.push(...findForbiddenKeysInNpmrc(npmrc));
  }
  findings.push(
    ...checkRequiredSettings(settingSources(workspaceYaml, packageJson)),
  );

  const tokens = forbiddenOptionTokens();
  if (packageJson !== null) {
    findings.push(...tokenFindings("package.json", packageJson, tokens));
  }
  const lefthook = readIfExists(join(root, "lefthook.yml"));
  if (lefthook !== null) {
    findings.push(...tokenFindings("lefthook.yml", lefthook, tokens));
  }
  findings.push(...scanWorkflows(root, tokens));
  findings.push(...scanScripts(root, tokens));

  return findings;
};

/** Format a finding as `file:line:col: message` or `file: message`. */
export const formatFinding = (finding: Finding): string => {
  if (finding.line === null || finding.column === null) {
    return `${finding.file}: ${finding.message}`;
  }
  return `${finding.file}:${finding.line}:${finding.column}: ${finding.message}`;
};
