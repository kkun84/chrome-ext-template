import { Effect, Layer, Schema } from "effect";
import { decodeSavedUrlList, SavedUrlList } from "../core/saved-urls.js";
import { Storage } from "../services/services.js";

const STORAGE_KEY = "savedUrls";

const encodeList = Schema.encodeSync(SavedUrlList);

/**
 * Live {@link Storage} layer backed by `chrome.storage.local`.
 *
 * Every value read from storage is decoded through the core schema; malformed
 * payloads degrade to an empty list instead of throwing. Values are encoded to
 * plain objects before writing so structured clone never sees a class instance.
 */
export const StorageLive = Layer.succeed(Storage, {
  load: () =>
    Effect.promise(async () => {
      const raw = await chrome.storage.local.get(STORAGE_KEY);
      return decodeSavedUrlList(raw[STORAGE_KEY]);
    }),
  save: (list: SavedUrlList) =>
    Effect.promise(async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: encodeList(list) });
    }),
});
