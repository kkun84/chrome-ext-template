import { Schema } from "effect";
import { SavedUrlSchema } from "./url.js";

/**
 * Request sent from the popup (imperative shell) to the background service
 * worker asking it to persist the currently active tab URL.
 */
export class SaveCurrentTabRequest extends Schema.TaggedClass<SaveCurrentTabRequest>()(
  "SaveCurrentTabRequest",
  {},
) {}

/** Request asking the background to return the persisted URL list. */
export class ListSavedUrlsRequest extends Schema.TaggedClass<ListSavedUrlsRequest>()(
  "ListSavedUrlsRequest",
  {},
) {}

/** Every request the popup can send to the background. */
export const Request = Schema.Union([
  SaveCurrentTabRequest,
  ListSavedUrlsRequest,
]);
export type Request = typeof Request.Type;

/** Response to {@link SaveCurrentTabRequest}. */
export class SaveCurrentTabSuccess extends Schema.TaggedClass<SaveCurrentTabSuccess>()(
  "SaveCurrentTabSuccess",
  {
    saved: SavedUrlSchema,
    alreadySaved: Schema.Boolean,
  },
) {}

/** Response to {@link ListSavedUrlsRequest}. */
export class ListSavedUrlsSuccess extends Schema.TaggedClass<ListSavedUrlsSuccess>()(
  "ListSavedUrlsSuccess",
  {
    urls: Schema.Array(SavedUrlSchema),
  },
) {}

/**
 * Failure envelope. `reason` is a small closed set so the UI can exhaustively
 * match without inspecting error strings.
 */
export const FailureReason = Schema.Literals([
  "no-active-tab",
  "invalid-url",
  "unknown",
]);
export type FailureReason = typeof FailureReason.Type;

export class RequestFailed extends Schema.TaggedClass<RequestFailed>()(
  "RequestFailed",
  {
    reason: FailureReason,
    detail: Schema.optional(Schema.String),
  },
) {}

/** Every response the background can send back to the popup. */
export const Response = Schema.Union([
  SaveCurrentTabSuccess,
  ListSavedUrlsSuccess,
  RequestFailed,
]);
export type Response = typeof Response.Type;

/** Envelope used on the wire: `{ kind: "request", payload }`. */
export class RequestEnvelope extends Schema.TaggedClass<RequestEnvelope>()(
  "RequestEnvelope",
  {
    payload: Request,
  },
) {}

/** Decode a raw `chrome.runtime.onMessage` payload into a request. */
export const decodeRequestEnvelope =
  Schema.decodeUnknownResult(RequestEnvelope);
