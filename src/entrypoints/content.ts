import { defineContentScript } from "wxt/utils/define-content-script";

/**
 * Minimal content script stub.
 *
 * It intentionally does nothing yet; it exists as an optional hook for future
 * features that need to run in the page context. Keep content scripts thin and
 * push logic into `src/services` / `src/core`.
 */
export default defineContentScript({
  // Placeholder only. Narrow (or remove) this when you add a real content-script
  // feature. Avoid `<all_urls>` unless the feature actually needs it; otherwise
  // Chrome will show that the extension can read data on every website.
  matches: ["https://example.com/*"],
  main() {
    // no-op placeholder
  },
});
