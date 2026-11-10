import { Effect, Layer, Ref } from "effect";
import type { SavedUrlList } from "../core/saved-urls.js";
import { SavedUrlList as SavedUrlListClass } from "../core/saved-urls.js";
import { Storage, Tabs } from "../services/services.js";

/**
 * In-memory {@link Storage} layer for tests. Holds the list in a `Ref` so tests
 * can assert persistence behaviour without touching `chrome.*`.
 */
export const StorageTest = (
  initial: SavedUrlList = SavedUrlListClass.empty,
): Layer.Layer<Storage> =>
  Layer.effect(
    Storage,
    Effect.gen(function* () {
      const ref = yield* Ref.make(initial);
      return {
        load: () => Ref.get(ref),
        save: (list) => Ref.set(ref, list),
      };
    }),
  );

/** In-memory {@link Tabs} layer returning a fixed URL (or none). */
export const TabsTest = (url: string | undefined): Layer.Layer<Tabs> =>
  Layer.succeed(Tabs, {
    getActiveTabUrl: () => Effect.succeed(url),
  });
