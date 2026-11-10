import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addCandidate,
  collectPaths,
  discoverFiles,
  type FoundFile,
  isLockfileName,
  SKIP_DIRS,
  walk,
} from "./ja-space-files.ts";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ja-space-files-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const write = (relativePath: string, content = ""): string => {
  const full = join(root, relativePath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
};

describe("isLockfileName", () => {
  it("recognises lockfiles", () => {
    expect(isLockfileName("pnpm-lock.yaml")).toBe(true);
    expect(isLockfileName("flake.lock")).toBe(true);
    expect(isLockfileName("README.md")).toBe(false);
  });
});

describe("addCandidate", () => {
  it("adds supported files and skips lockfiles/unknown extensions", () => {
    const out: FoundFile[] = [];
    addCandidate(root, "notes.md", out);
    addCandidate(root, "pnpm-lock.yaml", out);
    addCandidate(root, "image.png", out);
    expect(out).toHaveLength(1);
    expect(out[0]?.mode).toBe("markdown");
  });
});

describe("walk", () => {
  it("recurses, skipping build output and symlinks", () => {
    write("a.md");
    write("src/b.ts");
    write("node_modules/c.md");
    write(".output/d.md");
    write("notes.txt");
    symlinkSync(join(root, "a.md"), join(root, "link.md"));
    const out: FoundFile[] = [];
    walk(root, out);
    const names = out.map((file) => file.path.replace(`${root}/`, "")).sort();
    expect(names).toEqual(["a.md", "src/b.ts"]);
  });

  it("exposes the skip directory set", () => {
    expect(SKIP_DIRS.has("node_modules")).toBe(true);
  });
});

describe("collectPaths", () => {
  it("collects explicit files and directories", () => {
    const md = write("one.md");
    write("dir/two.ts");
    const out = collectPaths([md, join(root, "dir")]);
    expect(out).toHaveLength(2);
  });

  it("ignores symlinks and missing paths", () => {
    const md = write("one.md");
    symlinkSync(md, join(root, "link.md"));
    expect(collectPaths([join(root, "link.md")])).toHaveLength(0);
    expect(collectPaths([join(root, "missing.md")])).toHaveLength(0);
  });
});

describe("discoverFiles", () => {
  it("finds supported files under the root", () => {
    write("a.md");
    write("b.html");
    const out = discoverFiles(root);
    expect(out).toHaveLength(2);
  });
});
