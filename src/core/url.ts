import { Schema } from "effect";

const SUPPORTED_PROTOCOLS = ["http:", "https:"] as const;

const isSupportedUrl = (value: string): boolean => {
  try {
    return SUPPORTED_PROTOCOLS.includes(
      new URL(value).protocol as (typeof SUPPORTED_PROTOCOLS)[number],
    );
  } catch {
    return false;
  }
};

/**
 * A validated, branded URL string that is safe to persist.
 *
 * Decoding enforces an absolute `http`/`https` URL, so boundary data (tab URLs,
 * storage payloads) is rejected unless it is genuinely persistable. Use
 * {@link SavedUrlSchema} to decode/encode values at the boundary.
 */
export const SavedUrlSchema = Schema.String.pipe(
  Schema.brand("SavedUrl"),
  Schema.check(Schema.makeFilter(isSupportedUrl)),
);

export type SavedUrl = typeof SavedUrlSchema.Type;

/** Encode a branded {@link SavedUrl} back into a plain string. */
export const encodeSavedUrl = Schema.encodeSync(SavedUrlSchema);

/**
 * Decode an arbitrary `unknown` (e.g. a tab URL coming from `chrome.tabs`) into
 * a {@link SavedUrl}. Returns `undefined` when the input is not a usable URL.
 *
 * This is the single validation point for URL-shaped boundary data.
 */
export const decodeSavedUrl = (input: unknown): SavedUrl | undefined => {
  const decoded = Schema.decodeUnknownOption(SavedUrlSchema)(input);
  if (decoded._tag === "None") {
    return undefined;
  }
  // Canonicalize (e.g. add the trailing slash) so equal URLs de-duplicate.
  return Schema.decodeUnknownSync(SavedUrlSchema)(
    new URL(decoded.value).toString(),
  );
};

/** The reasons a URL can be rejected before it is persisted. */
export const UrlRejectionReason = Schema.Literals([
  "empty",
  "unsupported-protocol",
]);
export type UrlRejectionReason = typeof UrlRejectionReason.Type;

export class UrlRejected extends Schema.TaggedError<UrlRejected>()(
  "UrlRejected",
  {
    input: Schema.String,
    reason: UrlRejectionReason,
  },
) {}

/**
 * Normalize and validate a raw string as a persistable URL.
 *
 * Pure function: no I/O, no globals. Returns a typed error instead of throwing.
 */
export const normalizeUrl = (
  raw: string,
):
  | { readonly ok: true; readonly value: SavedUrl }
  | { readonly ok: false; readonly error: UrlRejected } => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return {
      ok: false,
      error: new UrlRejected({ input: raw, reason: "empty" }),
    };
  }

  const decoded = decodeSavedUrl(trimmed);
  if (decoded === undefined) {
    return {
      ok: false,
      error: new UrlRejected({ input: raw, reason: "unsupported-protocol" }),
    };
  }

  return { ok: true, value: decoded };
};
