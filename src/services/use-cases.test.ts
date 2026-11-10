import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { StorageTest, TabsTest } from "../layers/test-layers.js";
import type { Storage, Tabs } from "./services.js";
import { listSavedUrls, saveCurrentTabUrl } from "./use-cases.js";

const run = <A, E>(
  effect: Effect.Effect<A, E, Storage | Tabs>,
  layer: Layer.Layer<Storage | Tabs>,
) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

const layerFor = (url: string | undefined) =>
  Layer.mergeAll(StorageTest(), TabsTest(url));

describe("saveCurrentTabUrl", () => {
  it("persists the active tab URL", async () => {
    const layer = layerFor("https://example.com/page");
    const [response, listed] = await run(
      Effect.gen(function* () {
        const saved = yield* saveCurrentTabUrl;
        const urls = yield* listSavedUrls;
        return [saved, urls] as const;
      }),
      layer,
    );
    expect(response._tag).toBe("SaveCurrentTabSuccess");

    expect(listed._tag).toBe("ListSavedUrlsSuccess");
    if (listed._tag === "ListSavedUrlsSuccess") {
      expect(listed.urls).toEqual(["https://example.com/page"]);
    }
  });

  it("returns no-active-tab when there is no URL", async () => {
    const response = await run(saveCurrentTabUrl, layerFor(undefined));
    expect(response._tag).toBe("RequestFailed");
    if (response._tag === "RequestFailed") {
      expect(response.reason).toBe("no-active-tab");
    }
  });

  it("returns invalid-url for unsupported protocols", async () => {
    const response = await run(
      saveCurrentTabUrl,
      layerFor("chrome://extensions"),
    );
    expect(response._tag).toBe("RequestFailed");
    if (response._tag === "RequestFailed") {
      expect(response.reason).toBe("invalid-url");
    }
  });
});
