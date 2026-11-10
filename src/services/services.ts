import type { Effect } from "effect";
import { Context } from "effect";
import type { SavedUrlList } from "../core/saved-urls.js";

/**
 * Persistence boundary for the saved URL list.
 *
 * Implementations live in `src/layers`. `E` is intentionally `never` here: all
 * boundary decoding happens inside the layer so callers never observe raw
 * storage errors.
 */
export class Storage extends Context.Service<
  Storage,
  {
    readonly load: () => Effect.Effect<SavedUrlList>;
    readonly save: (list: SavedUrlList) => Effect.Effect<void>;
  }
>()("chrome-ext-template/Storage") {}

/** Reads the URL of the currently active tab. */
export class Tabs extends Context.Service<
  Tabs,
  {
    /** Returns the active tab URL, or `undefined` when unavailable. */
    readonly getActiveTabUrl: () => Effect.Effect<string | undefined>;
  }
>()("chrome-ext-template/Tabs") {}

/** Sends a request to the background and decodes its response. */
export class Messaging extends Context.Service<
  Messaging,
  {
    readonly send: (
      request: unknown,
    ) => Effect.Effect<import("../core/messages.js").Response>;
  }
>()("chrome-ext-template/Messaging") {}
