import { Effect, Layer } from "effect";
import { selectPersistableUrl, type TabCandidate } from "../core/tabs.js";
import { decodeSavedUrl } from "../core/url.js";
import { Tabs } from "../services/services.js";

const toCandidate = (
  tab: chrome.tabs.Tab,
  focusedWindowId: number | undefined,
): TabCandidate => ({
  url: typeof tab.url === "string" && tab.url.length > 0 ? tab.url : undefined,
  active: tab.active === true,
  windowId: tab.windowId,
  lastFocusedWindow: tab.windowId === focusedWindowId,
});

/**
 * Live {@link Tabs} layer backed by `chrome.tabs`.
 *
 * The active tab is not always persistable: when the popup is opened directly
 * as a page (`chrome-extension://.../popup.html`) it becomes the active tab in
 * the last-focused window. To keep the save flow useful we fall back to another
 * `http`/`https` tab (preferring the last-focused window) instead of failing.
 *
 * Returns `undefined` (rather than failing) when no persistable tab exists.
 */
export const TabsLive = Layer.succeed(Tabs, {
  getActiveTabUrl: () =>
    Effect.promise(async () => {
      const windows = await chrome.windows.getAll({
        populate: false,
        windowTypes: ["normal"],
      });
      const focusedWindow =
        windows.find((window) => window.focused === true) ?? windows[0];
      const tabs = await chrome.tabs.query({});
      const focusedWindowId = focusedWindow?.id;

      return selectPersistableUrl(
        tabs.map((tab) => toCandidate(tab, focusedWindowId)),
        (url) => decodeSavedUrl(url) !== undefined,
      );
    }),
});
