import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
} from "@playwright/test";

/**
 * Smoke test: build output must load as an unpacked Chrome MV3 extension and
 * expose a reachable popup page and service worker.
 *
 * Run `pnpm build` first (the `test:e2e` script does it).
 */

const here = dirname(fileURLToPath(import.meta.url));
const extensionPath = resolve(here, "../.output/chrome-mv3");

/** Wait for the extension's MV3 service worker and return its id. */
const extensionId = async (context: BrowserContext): Promise<string> => {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  return new URL(serviceWorker.url()).host;
};

/** Open the popup page directly (this is what makes it the "active" tab). */
const openPopup = async (context: BrowserContext): Promise<Page> => {
  const id = await extensionId(context);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  return popup;
};

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
    const id = await extensionId(context);
    expect(id.length).toBeGreaterThan(0);

    const popup = await openPopup(context);
    await expect(
      popup.getByRole("heading", { name: "保存した URL" }),
    ).toBeVisible();
    await expect(
      popup.getByRole("button", { name: "現在のタブの URL を保存" }),
    ).toBeVisible();
  });

  test("saves the active tab URL and persists it across popup reloads", async () => {
    const id = await extensionId(context);

    // Open a real https page so there is a persistable tab to save. The popup
    // page itself is not persistable, which exercises the TabsLive fallback.
    const page = await context.newPage();
    await page.goto("https://example.com/", { waitUntil: "load" });

    let popup = await openPopup(context);
    const savedUrl = "https://example.com/";

    await popup
      .getByRole("button", { name: "現在のタブの URL を保存" })
      .click();
    await expect(
      popup.locator("#urls li", { hasText: savedUrl }),
    ).toBeVisible();

    // Reload the popup: this proves the URL lives in `chrome.storage`, not in
    // in-memory UI state (the popup's JS is torn down on reload).
    await popup.reload();
    await expect(
      popup.locator("#urls li", { hasText: savedUrl }),
    ).toBeVisible();

    await popup.close();

    // Also reopen as a brand new page for a second persistence check.
    popup = await context.newPage();
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await expect(
      popup.locator("#urls li", { hasText: savedUrl }),
    ).toBeVisible();
  });
});
