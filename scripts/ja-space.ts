/**
 * Japanese typography checker: never put a regular space (U+0020) between
 * Japanese text and an adjacent ASCII word. Spacing is the renderer's job.
 *
 * The module is a pure library: it takes a string and returns violations or a
 * fixed string. It has no I/O. `lint-ja-space.ts` is the thin CLI shell.
 *
 * Masking is file-type aware:
 * - `markdown`   — skip YAML front matter, fenced/indented code blocks, inline
 *                  code spans and URLs. The backticks of an inline code span
 *                  count as ASCII so `の `code`` is flagged.
 * - `typescript` — check only `//` and block comments plus string literals.
 * - `yaml`       — check only `#` comments.
 * - `shell`      — check only `#` comments.
 * - `html`       — check only text nodes and quoted attribute values.
 * - `plain`      — check everything, skipping URLs.
 */

/** Japanese class from the typography rule. */
const JP_CLASS =
  "\\u3041-\\u3093\\u30A1-\\u30F6\\u4E00-\\u9FFF\\u3000-\\u303F\\uFF01-\\uFF5E";

const JP_CHAR = new RegExp(`^[${JP_CLASS}]$`);

/** First character of an ASCII word. */
const WORD_START = /^[A-Za-z0-9_]$/;
/** Any character that may continue an ASCII word. */
const WORD_CHAR = /^[A-Za-z0-9._-]$/;

const FILLER = "\u0000";
const ASCII_BACKTICK = "x";

/** Which masking strategy to apply before detecting. */
export type MaskMode =
  | "markdown"
  | "typescript"
  | "yaml"
  | "shell"
  | "html"
  | "plain";

/** Direction of a violation. */
export type Direction = "jp-to-ascii" | "ascii-to-jp";

/** A single forbidden space. */
export interface Violation {
  /** Index of the U+0020 character in the input. */
  readonly index: number;
  /** 1-based line number. */
  readonly line: number;
  /** 1-based column number. */
  readonly column: number;
  readonly direction: Direction;
  /** Character immediately before the space (may be a backtick). */
  readonly before: string;
  /** Character immediately after the space. */
  readonly after: string;
}

/** Options for {@link detectJaSpace} and {@link fixJaSpace}. */
export interface JaSpaceOptions {
  readonly mode: MaskMode;
}

const isJp = (ch: string | undefined): boolean =>
  ch !== undefined && JP_CHAR.test(ch);

const isWordStart = (ch: string | undefined): boolean =>
  ch !== undefined && WORD_START.test(ch);

const isWordChar = (ch: string | undefined): boolean =>
  ch !== undefined && WORD_CHAR.test(ch);

const isDigit = (ch: string | undefined): boolean =>
  ch !== undefined && /^[0-9]$/.test(ch);

/** True when an ASCII word ends at index `i` (walk back to a word start). */
const asciiWordEndsAt = (view: readonly string[], i: number): boolean => {
  if (i < 0 || !isWordChar(view[i])) {
    return false;
  }
  let start = i;
  while (start > 0 && isWordChar(view[start - 1])) {
    start -= 1;
  }
  return isWordStart(view[start]);
};

const lineColumnAt = (
  input: string,
  index: number,
): {
  line: number;
  column: number;
} => {
  let line = 1;
  let column = 1;
  for (let i = 0; i < index; i += 1) {
    if (input[i] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
};

/**
 * Turn the raw input into a "view" where inactive characters become a filler
 * and matched inline-code backticks become an ASCII letter. Length is preserved
 * so indices map back to the original string.
 */
const buildView = (input: string, mode: MaskMode): string[] => {
  const chars = [...input];
  const active = chars.map(() => true);
  const view = [...chars];

  if (mode === "markdown") {
    maskFrontMatter(chars, active);
    maskFencedCode(chars, active);
    maskIndentedCode(chars, active);
    maskInlineCode(chars, active, view);
  } else if (mode === "typescript") {
    maskCodeCommentsAndStrings(chars, active);
  } else if (mode === "yaml") {
    maskYamlComments(chars, active);
  } else if (mode === "shell") {
    maskShellComments(chars, active);
  } else if (mode === "html") {
    maskHtml(chars, active);
  }

  maskUrls(chars, active);

  if (mode === "markdown") {
    maskLinkTailSpace(chars, active);
    maskIssueReferenceSpace(chars, active);
    maskOrderedListMarkerSpace(chars, active);
  } else {
    maskIssueReferenceSpace(chars, active);
  }

  for (let i = 0; i < chars.length; i += 1) {
    if (!active[i]) {
      view[i] = FILLER;
    }
  }
  return view;
};

/** Find the end (exclusive) of the line containing `from`. */
const lineEnd = (chars: readonly string[], from: number): number => {
  let i = from;
  while (i < chars.length && chars[i] !== "\n") {
    i += 1;
  }
  return i;
};

/** Skip a leading `---` YAML front matter block, if present. */
const maskFrontMatter = (chars: string[], active: boolean[]): void => {
  const firstLineEnd = lineEnd(chars, 0);
  const firstLine = chars.slice(0, firstLineEnd).join("").trimEnd();
  if (firstLine !== "---") {
    return;
  }
  for (let i = 0; i < firstLineEnd; i += 1) {
    active[i] = false;
  }
  let lineStart = firstLineEnd + 1;
  while (lineStart < chars.length) {
    const end = lineEnd(chars, lineStart);
    const text = chars.slice(lineStart, end).join("").trimEnd();
    for (let i = lineStart; i < end; i += 1) {
      active[i] = false;
    }
    if (text === "---" || text === "...") {
      return;
    }
    lineStart = end + 1;
  }
};

interface LineRange {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const lines = (chars: readonly string[]): LineRange[] => {
  const result: LineRange[] = [];
  let start = 0;
  while (start <= chars.length) {
    const end = lineEnd(chars, start);
    result.push({ start, end, text: chars.slice(start, end).join("") });
    if (end >= chars.length) {
      break;
    }
    start = end + 1;
  }
  return result;
};

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** Mask fenced code blocks (``` / ~~~), including the fence lines. */
const maskFencedCode = (chars: string[], active: boolean[]): void => {
  let fenceChar: string | null = null;
  let fenceLength = 0;
  for (const line of lines(chars)) {
    if (fenceChar === null) {
      const match = FENCE.exec(line.text);
      if (match?.[1]) {
        fenceChar = match[1][0] ?? null;
        fenceLength = match[1].length;
        for (let i = line.start; i < line.end; i += 1) {
          active[i] = false;
        }
      }
      continue;
    }
    for (let i = line.start; i < line.end; i += 1) {
      active[i] = false;
    }
    const closing = new RegExp(`^ {0,3}${fenceChar}{${fenceLength},}\\s*$`);
    if (closing.test(line.text)) {
      fenceChar = null;
      fenceLength = 0;
    }
  }
};

/** Mask indented code blocks: 4+ spaces after a blank line, not in a list. */
const maskIndentedCode = (chars: string[], active: boolean[]): void => {
  const all = lines(chars);
  let inBlock = false;
  let previousBlank = true;
  for (const line of all) {
    const blank = line.text.trim() === "";
    const indented = /^ {4,}/.test(line.text) && line.text.trim() !== "";
    if (indented && (previousBlank || inBlock)) {
      for (let i = line.start; i < line.end; i += 1) {
        active[i] = false;
      }
      inBlock = true;
    } else if (!indented) {
      inBlock = false;
    }
    previousBlank = blank;
  }
};

/**
 * Mask inline code span content and mark the delimiters as ASCII. Backtick runs
 * must be closed by a run of the exact same length before a blank line.
 */
const maskInlineCode = (
  chars: string[],
  active: boolean[],
  view: string[],
): void => {
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== "`" || !active[i]) {
      i += 1;
      continue;
    }
    let run = 0;
    while (chars[i + run] === "`") {
      run += 1;
    }
    const close = findBacktickRun(chars, active, i + run, run);
    if (close < 0) {
      i += run;
      continue;
    }
    for (let k = i; k < i + run; k += 1) {
      view[k] = ASCII_BACKTICK;
    }
    for (let k = close; k < close + run; k += 1) {
      view[k] = ASCII_BACKTICK;
    }
    for (let k = i + run; k < close; k += 1) {
      active[k] = false;
    }
    i = close + run;
  }
};

/** Find the next run of exactly `length` backticks before a blank line. */
const findBacktickRun = (
  chars: readonly string[],
  active: readonly boolean[],
  from: number,
  length: number,
): number => {
  let i = from;
  let blankRun = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (ch === " " || ch === "\t") {
      blankRun += 1;
      if (blankRun >= 2) {
        return -1;
      }
      i += 1;
      continue;
    }
    blankRun = 0;
    if (ch === "`" && active[i]) {
      const run = backtickRunLength(chars, i);
      if (run === length) {
        return i;
      }
      i += run;
      continue;
    }
    i += 1;
  }
  return -1;
};

const backtickRunLength = (chars: readonly string[], from: number): number => {
  let run = 0;
  while (chars[from + run] === "`") {
    run += 1;
  }
  return run;
};

const URL_PATTERN = /\b(?:https?|ftp|mailto):[^\s<>"'`)\]]+/g;

/** Mask URL tokens in every mode. */
const maskUrls = (chars: string[], active: boolean[]): void => {
  const text = chars.join("");
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index;
    if (start === undefined) {
      continue;
    }
    for (let i = start; i < start + match[0].length; i += 1) {
      active[i] = false;
    }
  }
};

/** Allow the single space after `](...)` or `][ref]` (links and images). */
const maskLinkTailSpace = (chars: string[], active: boolean[]): void => {
  for (let i = 0; i < chars.length - 1; i += 1) {
    if (chars[i] !== "]") {
      continue;
    }
    const next = chars[i + 1];
    if (next === "(") {
      const close = matchParens(chars, i + 1);
      if (close >= 0 && chars[close + 1] === " ") {
        active[close + 1] = false;
      }
    } else if (next === "[") {
      const close = chars.indexOf("]", i + 2);
      if (close >= 0 && chars[close + 1] === " ") {
        active[close + 1] = false;
      }
    }
  }
};

const matchParens = (chars: readonly string[], open: number): number => {
  let depth = 0;
  for (let i = open; i < chars.length; i += 1) {
    if (chars[i] === "(") {
      depth += 1;
    } else if (chars[i] === ")") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
};

/** Allow the space after an issue reference such as `#123`. */
const maskIssueReferenceSpace = (chars: string[], active: boolean[]): void => {
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] !== "#") {
      continue;
    }
    let j = i + 1;
    while (j < chars.length && isDigit(chars[j])) {
      j += 1;
    }
    if (j > i + 1 && chars[j] === " ") {
      active[j] = false;
    }
  }
};

/** Allow the space after a line-leading ordered list marker like `1. `. */
const maskOrderedListMarkerSpace = (
  chars: string[],
  active: boolean[],
): void => {
  for (const line of lines(chars)) {
    const match = /^( *\d+\.) /.exec(line.text);
    if (match?.[1] !== undefined) {
      active[line.start + match[1].length] = false;
    }
  }
};

/** Mask everything except `//` / block comments and string literals. */
const maskCodeCommentsAndStrings = (
  chars: string[],
  active: boolean[],
): void => {
  active.fill(false);
  let i = 0;
  while (i < chars.length) {
    i = maskCodeToken(chars, active, i);
  }
};

/** Mask one comment or string literal starting at `i`; return the next index. */
const maskCodeToken = (
  chars: string[],
  active: boolean[],
  i: number,
): number => {
  const ch = chars[i];
  const next = chars[i + 1];
  if (ch === "/" && next === "/") {
    return maskLineComment(chars, active, i);
  }
  if (ch === "/" && next === "*") {
    return maskBlockComment(chars, active, i);
  }
  if (ch === "'" || ch === '"' || ch === "`") {
    return maskStringLiteral(chars, active, i, ch);
  }
  return i + 1;
};

const maskLineComment = (
  chars: string[],
  active: boolean[],
  from: number,
): number => {
  let i = from;
  while (i < chars.length && chars[i] !== "\n") {
    active[i] = true;
    i += 1;
  }
  return i;
};

const maskBlockComment = (
  chars: string[],
  active: boolean[],
  from: number,
): number => {
  let i = from + 2;
  active[from] = true;
  active[from + 1] = true;
  while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) {
    active[i] = true;
    i += 1;
  }
  return markThrough(active, chars.length, i, 2);
};

const maskStringLiteral = (
  chars: string[],
  active: boolean[],
  from: number,
  quote: string,
): number => {
  let i = from + 1;
  active[from] = true;
  while (i < chars.length) {
    if (chars[i] === "\\") {
      active[i] = true;
      active[i + 1] = true;
      i += 2;
      continue;
    }
    active[i] = true;
    if (chars[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return i;
};

/** Mark `count` characters from `from` as active, clamped to `limit`. */
const markThrough = (
  active: boolean[],
  limit: number,
  from: number,
  count: number,
): number => {
  for (let k = from; k < Math.min(from + count, limit); k += 1) {
    active[k] = true;
  }
  return Math.min(from + count, limit);
};

/** Mask everything except YAML `#` comments. */
const maskYamlComments = (chars: string[], active: boolean[]): void => {
  maskHashComments(chars, active, false);
};

/** Mask everything except shell `#` comments. */
const maskShellComments = (chars: string[], active: boolean[]): void => {
  maskHashComments(chars, active, true);
};

/** Mask only `#` comments; `backslash` enables shell-style escapes. */
const maskHashComments = (
  chars: string[],
  active: boolean[],
  backslash: boolean,
): void => {
  active.fill(false);
  for (const line of lines(chars)) {
    const start = findHashComment(chars, line, backslash);
    if (start >= 0) {
      for (let k = start; k < line.end; k += 1) {
        active[k] = true;
      }
    }
  }
};

/** Index of the `#` starting a comment on a line, or -1. */
const findHashComment = (
  chars: readonly string[],
  line: LineRange,
  backslash: boolean,
): number => {
  let quote: string | null = null;
  for (let i = line.start; i < line.end; i += 1) {
    const ch = chars[i];
    if (quote !== null) {
      if (backslash && ch === "\\") {
        i += 1;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (startsHashComment(chars, i, line.start)) {
      return i;
    }
  }
  return -1;
};

/** True when a `#` at `i` opens a comment (line start or after a space). */
const startsHashComment = (
  chars: readonly string[],
  i: number,
  lineStart: number,
): boolean => chars[i] === "#" && (i === lineStart || chars[i - 1] === " ");

/** Mask everything except HTML text nodes and quoted attribute values. */
const maskHtml = (chars: string[], active: boolean[]): void => {
  active.fill(true);
  let i = 0;
  while (i < chars.length) {
    i = chars[i] === "<" ? maskHtmlFrom(chars, active, i) : i + 1;
  }
};

/** Mask an HTML comment or tag starting at `i`; return the next index. */
const maskHtmlFrom = (
  chars: string[],
  active: boolean[],
  from: number,
): number => {
  if (chars.slice(from, from + 4).join("") === "<!--") {
    const stop = htmlRunEnd(chars, chars.indexOf(">", from + 4));
    deactivate(active, from, stop);
    return stop;
  }
  const stop = htmlRunEnd(chars, chars.indexOf(">", from));
  deactivate(active, from, stop);
  maskAttributes(chars, active, from, stop);
  const name = htmlTagName(chars, from, stop);
  if (name === "script" || name === "style") {
    return maskRawText(chars, active, name, stop);
  }
  return stop;
};

/** End index (exclusive) for a run that should stop just after `closeAt`. */
const htmlRunEnd = (chars: readonly string[], closeAt: number): number =>
  closeAt < 0 ? chars.length : closeAt + 1;

const htmlTagName = (
  chars: readonly string[],
  from: number,
  to: number,
): string | undefined => {
  const match = /^<\/?\s*([a-zA-Z0-9]+)/.exec(chars.slice(from, to).join(""));
  return match?.[1]?.toLowerCase();
};

/** Mask the body of a `<script>` / `<style>` element. */
const maskRawText = (
  chars: string[],
  active: boolean[],
  name: string,
  from: number,
): number => {
  const rest = chars.slice(from).join("");
  const match = new RegExp(`</${name}\\s*>`, "i").exec(rest);
  const bodyEnd =
    match?.index === undefined ? chars.length : from + match.index;
  deactivate(active, from, bodyEnd);
  return bodyEnd;
};

const deactivate = (active: boolean[], from: number, to: number): void => {
  for (let k = from; k < to; k += 1) {
    active[k] = false;
  }
};

/** Mark quoted attribute values inside a tag as active. */
const maskAttributes = (
  chars: string[],
  active: boolean[],
  from: number,
  to: number,
): void => {
  let i = from;
  while (i < to) {
    const ch = chars[i];
    if (ch === '"' || ch === "'") {
      const end = chars.indexOf(ch, i + 1);
      const stop = end < 0 || end >= to ? to : end + 1;
      for (let k = i + 1; k < stop - 1; k += 1) {
        active[k] = true;
      }
      i = stop;
      continue;
    }
    i += 1;
  }
};

/** Detect every forbidden JP/ASCII space in `input`. */
export const detectJaSpace = (
  input: string,
  options: JaSpaceOptions,
): Violation[] => {
  const view = buildView(input, options.mode);
  const result: Violation[] = [];
  for (let i = 0; i < view.length; i += 1) {
    if (view[i] !== " ") {
      continue;
    }
    const before = view[i - 1];
    const after = view[i + 1];
    let direction: Direction | null = null;
    if (isJp(before) && isWordStart(after)) {
      direction = "jp-to-ascii";
    } else if (asciiWordEndsAt(view, i - 1) && isJp(after)) {
      direction = "ascii-to-jp";
    }
    if (direction === null) {
      continue;
    }
    const { line, column } = lineColumnAt(input, i);
    result.push({
      index: i,
      line,
      column,
      direction,
      before: before ?? "",
      after: after ?? "",
    });
  }
  return result;
};

/**
 * Remove every forbidden JP/ASCII space. The operation is idempotent: removing
 * a space cannot create a new violation.
 */
export const fixJaSpace = (
  input: string,
  options: JaSpaceOptions,
): { fixed: string; violations: Violation[] } => {
  const violations = detectJaSpace(input, options);
  if (violations.length === 0) {
    return { fixed: input, violations };
  }
  const remove = new Set(violations.map((violation) => violation.index));
  const fixed = [...input].filter((_, index) => !remove.has(index)).join("");
  return { fixed, violations };
};

/** Map a file extension to its mask mode, or `null` when unsupported. */
export const modeForExtension = (extension: string): MaskMode | null => {
  switch (extension.toLowerCase()) {
    case ".md":
      return "markdown";
    case ".ts":
    case ".tsx":
    case ".js":
      return "typescript";
    case ".yml":
    case ".yaml":
      return "yaml";
    case ".sh":
      return "shell";
    case ".html":
      return "html";
    default:
      return null;
  }
};
