import { describe, expect, it } from "vitest";
import { selectPersistableUrl, type TabCandidate } from "./tabs.js";
import { decodeSavedUrl } from "./url.js";

const isPersistable = (url: string) => decodeSavedUrl(url) !== undefined;

const tab = (over: Partial<TabCandidate>): TabCandidate => ({
  url: undefined,
  active: false,
  windowId: 1,
  lastFocusedWindow: false,
  ...over,
});

describe("selectPersistableUrl", () => {
  it("prefers the active tab when it has a persistable URL", () => {
    expect(
      selectPersistableUrl(
        [
          tab({ url: "https://other.example/", windowId: 1 }),
          tab({
            url: "https://active.example/",
            active: true,
            lastFocusedWindow: true,
          }),
        ],
        isPersistable,
      ),
    ).toBe("https://active.example/");
  });

  it("falls back to a persistable tab when the active tab is the popup", () => {
    // Mirrors the real E2E case: the active tab is the extension popup page,
    // which is not persistable, but another tab in the window is.
    expect(
      selectPersistableUrl(
        [
          tab({
            url: "chrome-extension://abc/popup.html",
            active: true,
            lastFocusedWindow: true,
          }),
          tab({ url: "https://example.com/", lastFocusedWindow: true }),
        ],
        isPersistable,
      ),
    ).toBe("https://example.com/");
  });

  it("prefers the last-focused window over other windows", () => {
    expect(
      selectPersistableUrl(
        [
          tab({ url: "https://other-window.example/", windowId: 1 }),
          tab({
            url: "https://focused.example/",
            windowId: 2,
            lastFocusedWindow: true,
          }),
        ],
        isPersistable,
      ),
    ).toBe("https://focused.example/");
  });

  it("returns undefined when no candidate is persistable", () => {
    expect(
      selectPersistableUrl(
        [
          tab({ url: "chrome://extensions", active: true }),
          tab({ url: "chrome-extension://abc/popup.html" }),
          tab({}),
        ],
        isPersistable,
      ),
    ).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(selectPersistableUrl([], isPersistable)).toBeUndefined();
  });
});
