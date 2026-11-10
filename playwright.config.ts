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

/**
 * Read an environment variable by name.
 *
 * `process.env[name]` (computed access) satisfies `noPropertyAccessFromIndexSignature`
 * in TypeScript, while a local helper avoids Biome's `useLiteralKeys` info that
 * would otherwise rewrite a bracketed string literal back to dot access.
 */
const readEnv = (name: string): string | undefined => process.env[name];

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(readEnv("CI")),
  retries: 0,
  workers: 1,
  reporter: readEnv("CI") ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    // Keep traces and screenshots only when a test fails so CI can upload them
    // without inflating artifacts on green runs.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
