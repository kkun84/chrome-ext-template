import { describe, expect, it } from "vitest";
import { addUrl, listUrls, removeUrl, SavedUrlList } from "./saved-urls.js";
import { decodeSavedUrl, normalizeUrl } from "./url.js";

const url = (s: string) => {
  const result = normalizeUrl(s);
  if (!result.ok) {
    throw new Error(`expected valid url: ${s}`);
  }
  return result.value;
};

describe("normalizeUrl", () => {
  it("accepts http and https URLs and trims whitespace", () => {
    expect(normalizeUrl(" https://example.com/a ").ok).toBe(true);
    expect(normalizeUrl("http://example.com").ok).toBe(true);
  });

  it("rejects empty input with a typed error", () => {
    const result = normalizeUrl("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("empty");
    }
  });

  it("rejects unsupported protocols", () => {
    const result = normalizeUrl("chrome://extensions");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("unsupported-protocol");
    }
  });

  it("rejects non-URL strings", () => {
    expect(normalizeUrl("not a url").ok).toBe(false);
  });
});

describe("decodeSavedUrl", () => {
  it("returns undefined for non-strings and bad protocols", () => {
    expect(decodeSavedUrl(42)).toBeUndefined();
    expect(decodeSavedUrl("ftp://example.com")).toBeUndefined();
    expect(decodeSavedUrl("chrome://extensions")).toBeUndefined();
  });

  it("canonicalizes valid URLs so duplicates collapse", () => {
    expect(decodeSavedUrl("https://example.com")).toBe("https://example.com/");
  });
});

describe("addUrl", () => {
  it("adds to the front and keeps newest first", () => {
    const first = addUrl(SavedUrlList.empty, url("https://a.example"), 1);
    const second = addUrl(first.list, url("https://b.example"), 2);
    expect(listUrls(second.list)).toEqual([
      "https://b.example/",
      "https://a.example/",
    ]);
  });

  it("de-duplicates and reports alreadySaved", () => {
    const first = addUrl(SavedUrlList.empty, url("https://a.example"), 1);
    const second = addUrl(first.list, url("https://b.example"), 2);
    const third = addUrl(second.list, url("https://a.example"), 3);

    expect(third.alreadySaved).toBe(true);
    expect(listUrls(third.list)).toEqual([
      "https://a.example/",
      "https://b.example/",
    ]);
  });

  it("moves an existing duplicate to the front", () => {
    const a = addUrl(SavedUrlList.empty, url("https://a.example"), 1);
    const b = addUrl(a.list, url("https://b.example"), 2);
    const again = addUrl(b.list, url("https://a.example"), 3);
    expect(listUrls(again.list)[0]).toBe("https://a.example/");
  });
});

describe("removeUrl", () => {
  it("removes the matching URL only", () => {
    const a = addUrl(SavedUrlList.empty, url("https://a.example"), 1);
    const b = addUrl(a.list, url("https://b.example"), 2);
    expect(listUrls(removeUrl(b.list, url("https://a.example")))).toEqual([
      "https://b.example/",
    ]);
  });
});

describe("SavedUrlList decoding", () => {
  it("falls back to empty for malformed payloads", async () => {
    const { decodeSavedUrlList } = await import("./saved-urls.js");
    expect(decodeSavedUrlList(undefined).entries).toEqual([]);
    expect(decodeSavedUrlList({ entries: "nope" }).entries).toEqual([]);
  });
});
