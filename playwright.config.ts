import { defineConfig } from "@playwright/test";

/**
 * Playwright config for the extension smoke tests.
 *
 * The extension must be built before running (`pnpm build`). The `test:e2e`
 * script does this automatically.
 *
 * Browsers are provided by the Nix flake (`playwright-driver`), which exports
 * `PLAYWRIGHT_BROWSERS_PATH`. When running outside Nix, Playwright's own
 * Chromium download (or `CHROME_PATH`) is used.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    // Keep traces and screenshots only when a test fails so CI can upload them
    // without inflating artifacts on green runs.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
