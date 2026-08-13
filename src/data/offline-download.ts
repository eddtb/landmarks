import { Image } from 'expo-image';
import { useSyncExternalStore } from 'react';

import { fetchArticle } from '@/data/article-client';
import {
  keepOfflineEnabled,
  packHydrated,
  packStory,
  packTelling,
  retainPackEntries,
  setKeepOffline,
  writePackStory,
  writePackTelling,
} from '@/data/offline-pack';
import { fetchRetold } from '@/data/retold-client';
import { onSavedChange, savedList, SavedPlace } from '@/data/saved';
import { fetchTelling } from '@/data/telling-client';

/**
 * The download engine behind "Keep saved stories offline": while the
 * toggle is on, everything the shelf holds gets its story downloaded —
 * article, retelling (or the short telling for places under the
 * retelling gate), hero images best-effort — one place at a time.
 * Sequential on purpose: downloads ride the same free-tier quota as
 * live reading, and a shelf is a handful of places, not an area.
 *
 * Failure is per-place and honest: a place that couldn't download
 * says so on the shelf and the next one still tries. Nothing here
 * ever gates reading — the pack only ADDS what the network would
 * have answered.
 */
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed';

const statuses = new Map<number, DownloadStatus>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function setStatus(pageId: number, status: DownloadStatus) {
  statuses.set(pageId, status);
  notify();
}

export function downloadStatus(pageId: number): DownloadStatus | undefined {
  return statuses.get(pageId);
}

export function useDownloadStatus(pageId: number): DownloadStatus | undefined {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => statuses.get(pageId),
    () => statuses.get(pageId)
  );
}

/** The name the screens ask with — the pack must answer to the same. */
const storyName = (place: SavedPlace) => place.item.subject ?? place.item.title;

/** Already fully represented in the pack — nothing left to fetch. */
function packed(place: SavedPlace): boolean {
  const story = packStory(storyName(place));
  if (!story) {
    return false;
  }
  // A place under the retelling gate is complete only once its short
  // telling landed too (when it has source text to tell from at all)
  if (!story.retold && place.item.extract?.trim() && !packTelling(place.item.pageId)) {
    return false;
  }
  return true;
}

async function downloadOne(place: SavedPlace): Promise<void> {
  const item = place.item;
  const name = storyName(place);
  setStatus(item.pageId, 'downloading');
  try {
    // Article first — extract-only places (plaques without pages) 404
    // here, which is a shape of story, not a failure
    let article = null;
    try {
      article = await fetchArticle(name);
    } catch {
      article = null;
    }

    // The retelling, complete (a cold generation streams to the end);
    // a 404 is the server's "under the gate" verdict — the telling
    // covers those below
    let retold = null;
    try {
      retold = await fetchRetold(name);
    } catch {
      retold = null;
    }

    let telling: string | null = null;
    if (!retold && item.extract?.trim()) {
      try {
        telling = await fetchTelling(item);
      } catch {
        telling = null;
      }
    }

    if (!article && !retold && telling === null) {
      // Nothing at all came back — the place would be wordless offline
      throw new Error(`Nothing downloadable for ${name}`);
    }

    writePackStory(name, { article, retold });
    if (telling !== null) {
      writePackTelling(item.pageId, telling);
    }

    // Images are best-effort: expo-image's disk cache is an LRU the
    // app cannot pin, so the TEXT is the promise, the pictures a hope
    const urls = [item.thumbnailUrl, (article?.images ?? [])[0]?.imageUrl].filter(
      (url): url is string => typeof url === 'string'
    );
    if (urls.length > 0) {
      try {
        await Image.prefetch?.(urls, 'memory-disk');
      } catch {
        // The hero may 404 or the disk may be full — the story survives
      }
    }

    setStatus(item.pageId, 'done');
  } catch (error) {
    console.warn(`[offline] download failed for ${name}:`, error);
    setStatus(item.pageId, 'failed');
  }
}

let current: Promise<void> | null = null;
let dirty = false;

/**
 * Bring the pack in step with the shelf: download what's missing,
 * drop what was un-saved, mark what's already there. Re-entrant calls
 * JOIN the in-flight run (never skip it — an awaiting caller must get
 * convergence, not a no-op) and queue one trailing pass, so a save
 * landing mid-run is picked up before the promise settles.
 */
export function syncDownloads(): Promise<void> {
  if (current) {
    dirty = true;
    return current;
  }
  current = (async () => {
    try {
      do {
        dirty = false;
        await packHydrated;
        const list = savedList();
        if (list === null || !keepOfflineEnabled()) {
          return;
        }

        // What the shelf no longer holds, the pack lets go
        retainPackEntries(
          list.map(storyName),
          list.map((place) => place.item.pageId)
        );

        for (const place of list) {
          if (packed(place)) {
            setStatus(place.item.pageId, 'done');
          } else {
            setStatus(place.item.pageId, 'queued');
          }
        }
        for (const place of list) {
          if (downloadStatus(place.item.pageId) === 'queued') {
            await downloadOne(place);
          }
        }
      } while (dirty);
    } finally {
      current = null;
    }
  })();
  return current;
}

/** The toggle's ON side: remember the choice, then fill the pack. */
export function enableKeepOffline() {
  setKeepOffline(true);
  void syncDownloads();
}

/** The OFF side: the purge — downloads go, saves stay. */
export function disableKeepOffline() {
  setKeepOffline(false);
  statuses.clear();
  notify();
}

// The shelf drives the pack: a save while the toggle is on downloads
// itself; an un-save is dropped. Hydration fires this too, so a
// relaunch with the toggle on re-marks (and finishes) the pack.
onSavedChange(() => {
  if (keepOfflineEnabled()) {
    void syncDownloads();
  }
});
void packHydrated.then(() => {
  if (keepOfflineEnabled()) {
    void syncDownloads();
  }
});

/** Tests only. */
export function resetDownloadsForTests() {
  statuses.clear();
  current = null;
  dirty = false;
}
