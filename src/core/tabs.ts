/**
 * Pure helpers for picking a persistable tab URL out of a set of candidate
 * tabs. The live `Tabs` layer maps `chrome.tabs.Tab` values into
 * {@link TabCandidate}s before calling these functions, keeping all selection
 * logic pure and unit-testable.
 */

/** Minimal, chrome-free view of a tab needed for URL selection. */
export type TabCandidate = {
  readonly url: string | undefined;
  readonly active: boolean;
  readonly windowId: number;
  readonly lastFocusedWindow: boolean;
};

/**
 * Pick the URL to persist from a list of candidate tabs.
 *
 * Preference order (small and deterministic):
 *
 * 1. the active tab, when it has a persistable `http`/`https` URL;
 * 2. otherwise any persistable tab in the last-focused window;
 * 3. otherwise any persistable tab at all.
 *
 * `isPersistable` is injected so this stays independent of `SavedUrl` branding
 * and remains a pure function. Returns `undefined` when no candidate qualifies.
 */
export const selectPersistableUrl = (
  tabs: ReadonlyArray<TabCandidate>,
  isPersistable: (url: string) => boolean,
): string | undefined => {
  const usable = (tab: TabCandidate): string | undefined =>
    tab.url !== undefined && isPersistable(tab.url) ? tab.url : undefined;

  const active = tabs.find((tab) => tab.active);
  const activeUrl = active ? usable(active) : undefined;
  if (activeUrl !== undefined) {
    return activeUrl;
  }

  const inFocusedWindow = tabs.find(
    (tab) => tab.lastFocusedWindow && usable(tab) !== undefined,
  );
  const focusedUrl = inFocusedWindow ? usable(inFocusedWindow) : undefined;
  if (focusedUrl !== undefined) {
    return focusedUrl;
  }

  const anyTab = tabs.find((tab) => usable(tab) !== undefined);
  return anyTab ? usable(anyTab) : undefined;
};
