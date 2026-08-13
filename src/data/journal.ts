import { useSyncExternalStore } from 'react';

import { persistedMap } from '@/data/persisted-cache';

/**
 * The journal: what the ground remembers of the reader (mock round A,
 * "the quiet ledger"). One never-expiring blob mapping pageId → the
 * two facts worth keeping: when the story was first READ (the reading
 * bar passed ~60% — an open is not a read) and when the reader last
 * STOOD at it (the 45m standing-on predicate, while its screen was
 * up). Entirely on-device; never sent anywhere; the feed's card
 * treatment and the count line are its only faces.
 *
 * Same single-blob shape as the saved shelf: persistedMap has no
 * delete, so the record must be rewritable as a whole, and one blob
 * makes every mark atomic.
 */
export type JournalEntry = { readAt?: number; visitedAt?: number };
type JournalRecord = Record<number, JournalEntry>;

// Infinity TTL: the pruner must never eat the reader's history
const store = persistedMap<JournalRecord>('journal-v1', Infinity);
const RecordKey = 'entries';

// A repeat visit within this window is the same visit — standing at a
// site writes once, not once per GPS tick
const RevisitMs = 6 * 60 * 60 * 1000;

let entries: JournalRecord | null = null;
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
  if (entries === null) {
    entries = store.peek(RecordKey)?.value ?? {};
    notify();
  }
});

// Marks may land before hydration (a cold open straight into a story):
// apply after the read instead of dropping them — the saved shelf's
// no-op guard protects a DESTRUCTIVE write; these only ever add.
function mutate(change: (current: JournalRecord) => JournalRecord | null) {
  const apply = () => {
    const next = change(entries ?? {});
    if (next) {
      entries = next;
      store.set(RecordKey, next);
      notify();
    }
  };
  if (entries === null) {
    void store.hydrated.then(apply);
  } else {
    apply();
  }
}

/** First read wins — the journal records the discovery, not the habit. */
export function markRead(pageId: number) {
  mutate((current) => {
    if (current[pageId]?.readAt) {
      return null;
    }
    return { ...current, [pageId]: { ...current[pageId], readAt: Date.now() } };
  });
}

/** Latest visit wins, debounced — standing still is one visit. */
export function markVisited(pageId: number) {
  mutate((current) => {
    const last = current[pageId]?.visitedAt;
    if (last && Date.now() - last < RevisitMs) {
      return null;
    }
    return { ...current, [pageId]: { ...current[pageId], visitedAt: Date.now() } };
  });
}

/** The entry, or undefined — including while the first read is in flight. */
export function journalEntry(pageId: number): JournalEntry | undefined {
  return entries?.[pageId];
}

export function useJournalEntry(pageId: number): JournalEntry | undefined {
  return useSyncExternalStore(
    subscribe,
    () => journalEntry(pageId),
    () => journalEntry(pageId)
  );
}

/** Tests only: the store is module-level and must not leak between them. */
export function setJournalForTests(next: JournalRecord | null) {
  entries = next;
  notify();
}
