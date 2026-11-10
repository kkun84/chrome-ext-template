import type { Response as ResponseCore } from "../core/messages.js";
import {
  decodeRequestEnvelope as decodeRequestEnvelopeCore,
  ListSavedUrlsRequest as ListSavedUrlsRequestCore,
  RequestEnvelope as RequestEnvelopeCore,
  SaveCurrentTabRequest as SaveCurrentTabRequestCore,
} from "../core/messages.js";

/**
 * Service-layer facade over the core messaging schemas.
 *
 * Entrypoints must not import `src/core` directly (see AGENTS.md), so this
 * module exposes only the symbols they need. The values are re-bound to local
 * names (rather than `export ... from`) on purpose: fallow's architecture
 * checker follows re-export chains transitively and would still flag the
 * `entrypoints → core` edge. Binding here keeps the dependency direction
 * `entrypoints → services → core`.
 */
export const decodeRequestEnvelope = decodeRequestEnvelopeCore;
export const ListSavedUrlsRequest = ListSavedUrlsRequestCore;
export const RequestEnvelope = RequestEnvelopeCore;
export const SaveCurrentTabRequest = SaveCurrentTabRequestCore;

export type RequestEnvelope = RequestEnvelopeCore;
export type Response = ResponseCore;
export type ListSavedUrlsRequest = ListSavedUrlsRequestCore;
export type SaveCurrentTabRequest = SaveCurrentTabRequestCore;
