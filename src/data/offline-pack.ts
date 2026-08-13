import { useSyncExternalStore } from 'react';

import { persistedMap } from '@/data/persisted-cache';
import { Article } from '@/types/article';
import { Retold } from '@/types/retold';

/**
 * What the keep-offline toggle downloaded: one never-expiring blob,
 * the same single-entry shape as the saved shelf and for the same
 * reason — persistedMap has no delete, so purging must be a write.
 *
 * Stories are keyed by the NAME the screens ask with (fetchArticle's
 * title, fetchRetold's area — for a place that is item.subject ??
 * item.title, lowercased like the retold client's own key); the
 * telling by pageId, fetchTelling's own key. The clients fall back
 * here when the network fails, so the keys must be theirs.
 *
 * This module holds only the data; the download engine that fills it
 * lives in offline-download.ts. The split keeps the client fallbacks
 * import-cycle-free: clients → pack, engine → clients + pack.
 */
export type PackStory = { article: Article | null; retold: Retold | null };

export type OfflinePack = {
  enabled: boolean;
  stories: Record<string, PackStory>;
  tellings: Record<string, string>;
};

const EmptyPack: OfflinePack = { enabled: false, stories: {}, tellings: {} };

const store = persistedMap<OfflinePack>('offline-pack', Infinity);
const PackKey = 'pack';

let pack: OfflinePack | null = null;
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

/** Resolves when the pack has read what the last session downloaded. */
export const packHydrated: Promise<void> = store.hydrated.then(() => {
  if (pack === null) {
    pack = store.peek(PackKey)?.value ?? EmptyPack;
    notify();
  }
});

function write(next: OfflinePack) {
  pack = next;
  store.set(PackKey, next);
  notify();
}

const storyKey = (name: string) => name.toLowerCase();

export function keepOfflineEnabled(): boolean {
  return pack?.enabled ?? false;
}

export function packStory(name: string): PackStory | undefined {
  return pack?.stories[storyKey(name)];
}

export function packTelling(pageId: number): string | undefined {
  return pack?.tellings[String(pageId)];
}

export function writePackStory(name: string, entry: PackStory) {
  if (pack === null) {
    return;
  }
  write({ ...pack, stories: { ...pack.stories, [storyKey(name)]: entry } });
}

export function writePackTelling(pageId: number, telling: string) {
  if (pack === null) {
    return;
  }
  write({ ...pack, tellings: { ...pack.tellings, [String(pageId)]: telling } });
}

/** Un-saved stories leave the pack — keep only what the shelf still holds. */
export function retainPackEntries(names: string[], pageIds: number[]) {
  if (pack === null) {
    return;
  }
  const keepStories = new Set(names.map(storyKey));
  const keepTellings = new Set(pageIds.map(String));
  const stories = Object.fromEntries(
    Object.entries(pack.stories).filter(([key]) => keepStories.has(key))
  );
  const tellings = Object.fromEntries(
    Object.entries(pack.tellings).filter(([key]) => keepTellings.has(key))
  );
  write({ ...pack, stories, tellings });
}

/** Toggle-off is a purge, not a flag flip: the downloads go with it. */
export function setKeepOffline(enabled: boolean) {
  if (pack === null) {
    return;
  }
  write(enabled ? { ...pack, enabled: true } : EmptyPack);
}

export function useKeepOffline(): boolean {
  return useSyncExternalStore(subscribe, keepOfflineEnabled, keepOfflineEnabled);
}

/** Tests only. */
export function setPackForTests(next: OfflinePack | null) {
  pack = next;
  notify();
}
