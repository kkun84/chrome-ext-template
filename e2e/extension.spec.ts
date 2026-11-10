import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";

/**
 * Smoke test: build output must load as an unpacked Chrome MV3 extension and
 * expose a reachable popup page and service worker.
 *
 * Run `pnpm build` first (the `test:e2e` script does it).
 */

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "../.output/chrome-mv3");

test.describe("unpacked extension smoke", () => {
  let context: BrowserContext;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), "chrome-ext-e2e-"));
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
  });

  test.afterAll(async () => {
    await context?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  test("loads with a service worker and reachable popup", async () => {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }
    expect(serviceWorker.url()).toContain("chrome-extension://");

    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);

    await expect(
      popup.getByRole("heading", { name: "保存した URL" }),
    ).toBeVisible();
    await expect(
      popup.getByRole("button", { name: "現在のタブの URL を保存" }),
    ).toBeVisible();
  });
});
