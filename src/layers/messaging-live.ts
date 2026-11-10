import { Effect, Layer, Schema } from "effect";
import { Response } from "../core/messages.js";
import { Messaging } from "../services/services.js";

const decodeResponse = Schema.decodeUnknownSync(Response);

/**
 * Live {@link Messaging} layer for the popup side: sends the request to the
 * background service worker and decodes the response.
 *
 * A malformed or missing response is surfaced as a `RequestFailed` with
 * `reason: "unknown"` so the UI can always exhaustively match on the result.
 */
export const MessagingLive = Layer.succeed(Messaging, {
  send: (request: unknown) =>
    Effect.promise(async () => {
      try {
        const raw = await chrome.runtime.sendMessage(request);
        return decodeResponse(raw);
      } catch {
        return decodeResponse({ _tag: "RequestFailed", reason: "unknown" });
      }
    }),
});
