import { Effect, Layer } from "effect";
import { Tabs } from "../services/services.js";

/**
 * Live {@link Tabs} layer backed by `chrome.tabs`.
 *
 * Returns `undefined` (rather than failing) whenever Chrome does not expose an
 * active tab URL, e.g. on `chrome://` pages or when the tab has no URL.
 */
export const TabsLive = Layer.succeed(Tabs, {
  getActiveTabUrl: () =>
    Effect.promise(async () => {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const url = tab?.url;
      return typeof url === "string" && url.length > 0 ? url : undefined;
    }),
});
