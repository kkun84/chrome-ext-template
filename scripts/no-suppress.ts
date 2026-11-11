/**
 * Pure library that flags suppression directive comments.
 *
 * It scans real comments only, so string literals and Markdown prose may still
 * name the directives when documenting the ban. The CLI shell is
 * `lint-no-suppress.ts`. The directive needles are assembled from split parts so
 * this file never contains a complete directive token.
 */

import { extname } from "node:path";

/** A single suppression finding. */
export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

interface Comment {
  readonly text: string;
  readonly index: number;
}

/**
 * The forbidden directive prefixes, assembled from split parts at runtime.
 *
 * A complete token never appears in this source file, so the checker can scan
 * `scripts/**` without flagging itself.
 */
export const suppressionDirectives = (): readonly string[] => [
  `biome${"-"}ignore`,
  `@ts${"-"}expect${"-"}error`,
  `@ts${"-"}ignore`,
  `@ts${"-"}nocheck`,
  `eslint${"-"}disable`,
  `fallow${"-"}ignore`,
];

/** Extensions that may contain comments we scan for directives. */
const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".sh",
  ".jsonc",
]);

/** True when a path has an extension this checker understands. */
export const isSupportedSuppressionFile = (path: string): boolean =>
  SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase());

const skipQuoted = (content: string, from: number, quote: string): number => {
  let i = from + 1;
  while (i < content.length) {
    if (content[i] === "\\") {
      i += 2;
      continue;
    }
    if (content[i] === quote) {
      return i + 1;
    }
    i += 1;
  }
  return i;
};

interface ScannedComment {
  readonly comment: Comment;
  readonly next: number;
}

const readLineComment = (content: string, from: number): ScannedComment => {
  const end = content.indexOf("\n", from);
  const stop = end < 0 ? content.length : end;
  return {
    comment: { text: content.slice(from, stop), index: from },
    next: stop,
  };
};

const readBlockComment = (content: string, from: number): ScannedComment => {
  const end = content.indexOf("*/", from + 2);
  const stop = end < 0 ? content.length : end + 2;
  return {
    comment: { text: content.slice(from, stop), index: from },
    next: stop,
  };
};

const readCodeComment = (
  content: string,
  from: number,
): ScannedComment | null => {
  if (content[from] === "/" && content[from + 1] === "/") {
    return readLineComment(content, from);
  }
  if (content[from] === "/" && content[from + 1] === "*") {
    return readBlockComment(content, from);
  }
  return null;
};

/** Collect `//` and block comments, skipping string / template literals. */
const scanCodeComments = (content: string): Comment[] => {
  const comments: Comment[] = [];
  let i = 0;
  while (i < content.length) {
    const scanned = readCodeComment(content, i);
    if (scanned !== null) {
      comments.push(scanned.comment);
      i = scanned.next;
      continue;
    }
    const ch = content[i];
    i =
      ch === '"' || ch === "'" || ch === "`"
        ? skipQuoted(content, i, ch)
        : i + 1;
  }
  return comments;
};

/** Collect block comments only (CSS). */
const scanBlockComments = (content: string): Comment[] => {
  const comments: Comment[] = [];
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf("/*", i);
    if (start < 0) {
      break;
    }
    const end = content.indexOf("*/", start + 2);
    const stop = end < 0 ? content.length : end + 2;
    comments.push({ text: content.slice(start, stop), index: start });
    i = stop;
  }
  return comments;
};

/** Collect `<!-- ... -->` comments (HTML). */
const scanHtmlComments = (content: string): Comment[] => {
  const comments: Comment[] = [];
  let i = 0;
  while (i < content.length) {
    const start = content.indexOf("<!--", i);
    if (start < 0) {
      break;
    }
    const end = content.indexOf("-->", start + 4);
    const stop = end < 0 ? content.length : end + 3;
    comments.push({ text: content.slice(start, stop), index: start });
    i = stop;
  }
  return comments;
};

/** Index of the `#` opening a comment on a line, or -1. */
const findHash = (line: string): number => {
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" || ch === '"') {
      i = skipQuoted(line, i, ch);
      continue;
    }
    if (
      ch === "#" &&
      (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")
    ) {
      return i;
    }
    i += 1;
  }
  return -1;
};

/** Collect `#` comments (YAML / shell), skipping a leading shebang. */
const scanHashComments = (content: string): Comment[] => {
  const comments: Comment[] = [];
  const lines = content.split("\n");
  let offset = 0;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? "";
    if (lineIndex === 0 && line.startsWith("#!")) {
      offset += line.length + 1;
      continue;
    }
    const index = findHash(line);
    if (index >= 0) {
      comments.push({ text: line.slice(index), index: offset + index });
    }
    offset += line.length + 1;
  }
  return comments;
};

const commentsFor = (content: string, extension: string): Comment[] => {
  switch (extension) {
    case ".css":
      return scanBlockComments(content);
    case ".html":
      return scanHtmlComments(content);
    case ".yml":
    case ".yaml":
    case ".sh":
      return scanHashComments(content);
    default:
      return scanCodeComments(content);
  }
};

/**
 * Find suppression directive comments in `content`. `extension` selects the
 * comment syntax (`.ts`, `.css`, `.html`, `.yml`, `.sh`, ...).
 */
export const findSuppressions = (
  content: string,
  extension: string,
): Finding[] => {
  const directives = suppressionDirectives();
  const findings: Finding[] = [];
  for (const comment of commentsFor(content, extension)) {
    for (const directive of directives) {
      if (comment.text.includes(directive)) {
        const before = content.slice(0, comment.index);
        const newlines = before.split("\n");
        const line = newlines.length;
        const column = (newlines[newlines.length - 1]?.length ?? 0) + 1;
        findings.push({
          file: "",
          line,
          column,
          message: `suppression comment is forbidden: ${directive}`,
        });
      }
    }
  }
  return findings;
};
