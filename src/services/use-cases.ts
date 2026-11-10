import { Effect } from "effect";
import {
  ListSavedUrlsSuccess,
  RequestFailed,
  SaveCurrentTabSuccess,
} from "../core/messages.js";
import { addUrl, listUrls } from "../core/saved-urls.js";
import { normalizeUrl } from "../core/url.js";
import { Storage, Tabs } from "./services.js";

/**
 * Use-case: read the active tab URL and persist it (de-duplicated) through the
 * {@link Storage} boundary.
 *
 * Pure domain decisions (validation, de-duplication, ordering) are delegated to
 * `src/core`; only the I/O is effectful.
 */
export const saveCurrentTabUrl = Effect.gen(function* () {
  const tabs = yield* Tabs;
  const storage = yield* Storage;

  const rawUrl = yield* tabs.getActiveTabUrl();
  if (rawUrl === undefined) {
    return new RequestFailed({ reason: "no-active-tab" });
  }

  const normalized = normalizeUrl(rawUrl);
  if (!normalized.ok) {
    return new RequestFailed({
      reason: "invalid-url",
      detail: normalized.error.reason,
    });
  }

  const current = yield* storage.load();
  const { list, alreadySaved } = addUrl(current, normalized.value, Date.now());
  yield* storage.save(list);

  return new SaveCurrentTabSuccess({ saved: normalized.value, alreadySaved });
});

/** Use-case: return the persisted URL list. */
export const listSavedUrls = Effect.gen(function* () {
  const storage = yield* Storage;
  const list = yield* storage.load();
  return new ListSavedUrlsSuccess({ urls: [...listUrls(list)] });
});
