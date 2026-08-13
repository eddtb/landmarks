import { useSyncExternalStore } from 'react';

import { persistedMap } from '@/data/persisted-cache';
import { HistoryItem } from '@/types/history';

/**
 * The saved shelf: places the user chose to keep. One never-expiring
 * entry holding the whole list — persistedMap has no delete, so
 * un-saving must be expressible as a WRITE (a smaller list), and the
 * single-blob shape makes every mutation atomic.
 *
 * The snapshot is load-bearing, not a convenience: synthetic heritage
 * ids (plaques, register entries) cannot be re-fetched from
 * /api/story — what is saved here is the only copy the device will
 * ever have. The place screen reads this store as a peer of the item
 * cache for exactly that reason.
 */
export type SavedPlace = { item: HistoryItem; savedAt: number };

// Infinity TTL: get always serves and the 2×TTL write-back prune can
// never fire — the shelf is the one store the pruner must not touch
const store = persistedMap<SavedPlace[]>('saved-places', Infinity);
const ListKey = 'list';

// The one-door pattern: a module store read via useSyncExternalStore,
// so the pill and the shelf learn of a save in the same frame. null
// while the first read is in flight — a returning user never sees a
// flash of the empty shelf.
let list: SavedPlace[] | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

void store.hydrated.then(() => {
  if (list === null) {
    list = store.peek(ListKey)?.value ?? [];
    notify();
  }
});

function write(next: SavedPlace[]) {
  list = next;
  store.set(ListKey, next);
  notify();
}

/** The list, newest save first — null while the first read is in flight. */
export function savedList(): SavedPlace[] | null {
  return list;
}

export function isSaved(pageId: number): boolean {
  return (list ?? []).some((saved) => saved.item.pageId === pageId);
}

/** The saved snapshot itself — the place screen's last-resort source. */
export function savedItem(pageId: number): HistoryItem | undefined {
  return (list ?? []).find((saved) => saved.item.pageId === pageId)?.item;
}

/**
 * Save or un-save. A no-op while the first read is in flight: a
 * toggle that raced hydration could overwrite the shelf with a
 * one-item list and silently erase every earlier save.
 */
export function toggleSaved(item: HistoryItem) {
  if (list === null) {
    return;
  }
  if (isSaved(item.pageId)) {
    write(list.filter((saved) => saved.item.pageId !== item.pageId));
  } else {
    write([{ item, savedAt: Date.now() }, ...list]);
  }
}

/** Module-level subscription — the download engine keeps the pack in
 * step with the shelf through this, outside any component. */
export function onSavedChange(listener: () => void): () => void {
  return subscribe(listener);
}

export function useSavedList(): SavedPlace[] | null {
  return useSyncExternalStore(subscribe, savedList, savedList);
}

export function useSaved(pageId: number): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSaved(pageId),
    () => isSaved(pageId)
  );
}

/** The snapshot, reactively — re-renders when hydration or a toggle lands. */
export function useSavedItem(pageId: number): HistoryItem | undefined {
  return useSyncExternalStore(
    subscribe,
    () => savedItem(pageId),
    () => savedItem(pageId)
  );
}

/** Tests only: the store is module-level and must not leak between them. */
export function setSavedForTests(next: SavedPlace[] | null) {
  list = next;
  notify();
}
