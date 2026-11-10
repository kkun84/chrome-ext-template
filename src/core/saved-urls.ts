import { Schema } from "effect";
import { type SavedUrl, SavedUrlSchema } from "./url.js";

/**
 * A single persisted entry. `savedAt` is epoch milliseconds so the value stays
 * trivially serializable through `chrome.storage`.
 */
class SavedUrlEntry extends Schema.Class<SavedUrlEntry>("SavedUrlEntry")({
  url: SavedUrlSchema,
  savedAt: Schema.Number,
}) {}

/** The persisted document shape, decoded at the `chrome.storage` boundary. */
export class SavedUrlList extends Schema.Class<SavedUrlList>("SavedUrlList")({
  entries: Schema.Array(SavedUrlEntry),
}) {
  static readonly empty = new SavedUrlList({ entries: [] });
}

/**
 * Decode a raw storage payload into a {@link SavedUrlList}.
 *
 * Missing or malformed payloads yield {@link SavedUrlList.empty} so the caller
 * never has to special-case "first run".
 */
export const decodeSavedUrlList = (raw: unknown): SavedUrlList => {
  const result = Schema.decodeUnknownResult(SavedUrlList)(raw);
  if (result._tag === "Success") {
    return result.success;
  }
  return SavedUrlList.empty;
};

export type AddResult = {
  readonly list: SavedUrlList;
  /** `true` when the URL was already present (no change was made). */
  readonly alreadySaved: boolean;
};

/**
 * Pure function: add a URL to the front of the list, de-duplicating by URL and
 * keeping the newest first. Existing duplicates are moved to the front.
 */
export const addUrl = (
  list: SavedUrlList,
  url: SavedUrl,
  now: number,
): AddResult => {
  const alreadySaved = list.entries.some((entry) => entry.url === url);
  const withoutDuplicate = list.entries.filter((entry) => entry.url !== url);
  const entry = new SavedUrlEntry({ url, savedAt: now });
  return {
    list: new SavedUrlList({ entries: [entry, ...withoutDuplicate] }),
    alreadySaved,
  };
};

/** Pure function: remove a URL from the list. */
export const removeUrl = (list: SavedUrlList, url: SavedUrl): SavedUrlList =>
  new SavedUrlList({
    entries: list.entries.filter((entry) => entry.url !== url),
  });

/** Pure function: list persisted URLs in stored order (newest first). */
export const listUrls = (list: SavedUrlList): ReadonlyArray<SavedUrl> =>
  list.entries.map((entry) => entry.url);
