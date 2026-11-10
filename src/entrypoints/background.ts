import { Effect, Layer } from "effect";
import { defineBackground } from "wxt/utils/define-background";
import {
  decodeRequestEnvelope,
  type RequestEnvelope,
} from "../core/messages.js";
import { StorageLive } from "../layers/storage-live.js";
import { TabsLive } from "../layers/tabs-live.js";
import { listSavedUrls, saveCurrentTabUrl } from "../services/use-cases.js";

const LiveLayer = Layer.mergeAll(StorageLive, TabsLive);

/**
 * Handle one decoded request and produce a response.
 *
 * `RequestEnvelope` is decoded at the boundary, so this function only ever sees
 * well-typed data. The `switch` is exhaustive over the request union.
 */
const handleRequest = (envelope: RequestEnvelope) =>
  Effect.gen(function* () {
    switch (envelope.payload._tag) {
      case "SaveCurrentTabRequest":
        return yield* saveCurrentTabUrl;
      case "ListSavedUrlsRequest":
        return yield* listSavedUrls;
    }
  }).pipe(Effect.provide(LiveLayer), Effect.orDie);

export default defineBackground(() => {
  // IMPORTANT (MV3): register listeners synchronously in the top-level body of
  // this callback. `defineBackground` runs it synchronously at service worker
  // startup, so the listener exists before Chrome delivers any message.
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const decoded = decodeRequestEnvelope(message);
    if (decoded._tag === "Failure") {
      // Not our message (or malformed); let other listeners handle it.
      return false;
    }

    // Return `true` to keep the message channel open for the async response.
    Effect.runPromise(handleRequest(decoded.success)).then(
      (response) => sendResponse(response),
      () => sendResponse({ _tag: "RequestFailed", reason: "unknown" }),
    );
    return true;
  });
});
