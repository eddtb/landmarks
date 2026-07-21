import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { persistedMap } from '@/data/persisted-cache';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const HourMs = 60 * 60 * 1000;

// Same session-cache pattern as the places list: keyed on an ~11m grid,
// individual items kept for the detail screen. Both now persist across
// process death (see persisted-cache.ts) BY THE SAME KEYS — the ~11m
// bucket keying is what makes persistence safe: movement always lands
// in a different bucket, so a stored list can never be served for the
// wrong location. TTLs govern re-asking about the SAME spot: the list
// mirrors the server's 1h bucket-staleness intent; an older persisted
// bucket is only ever a placeholder (serve-stale-while-revalidate) or
// an offline fallback, never a quiet substitute. Items are content by
// pageId (not location-served), kept a week for the detail screen.
const listCache = persistedMap<HistoryItem[]>('history-list', HourMs);
const itemCache = persistedMap<HistoryItem>('history-item', 7 * 24 * HourMs);

function cacheKey(center: Coordinates): string {
  return `${center.latitude.toFixed(4)}|${center.longitude.toFixed(4)}`;
}

export type HistoryFetchResult = {
  items: HistoryItem[];
  /** A network failure forced serving saved stories — the UI may say so. */
  stale?: boolean;
  /** Present when items are an expired persisted bucket shown instantly
   * as a placeholder; resolves with the fresh (or offline-stale) result. */
  revalidate?: Promise<HistoryFetchResult>;
};

export async function fetchNearbyHistory(
  center: Coordinates,
  options?: { forceRefresh?: boolean }
): Promise<HistoryFetchResult> {
  const key = cacheKey(center);
  if (!options?.forceRefresh) {
    let cached = listCache.get(key);
    if (cached === undefined) {
      // Cache miss: persisted entries may still be loading — await
      // hydration once, then check again before spending a fetch
      await listCache.hydrated;
      cached = listCache.get(key);
    }
    if (cached) {
      return { items: cached };
    }

    // An expired bucket for this exact spot paints instantly while the
    // re-ask runs — a placeholder, not a substitute
    const expired = listCache.peek(key);
    if (expired) {
      return { items: expired.value, revalidate: fetchFresh(center, key, options) };
    }
  }

  return fetchFresh(center, key, options);
}

async function fetchFresh(
  center: Coordinates,
  key: string,
  options?: { forceRefresh?: boolean }
): Promise<HistoryFetchResult> {
  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
  });
  if (options?.forceRefresh) {
    params.set('fresh', '1'); // a deliberate pull must bypass the server's bucket cache too
  }

  try {
    const response = await fetch(apiUrl(`/api/history?${params}`));
    if (!response.ok) {
      throw new Error(`History request failed with status ${response.status}`);
    }

    const body = (await response.json()) as { items: HistoryItem[] };
    listCache.set(key, body.items);
    for (const item of body.items) {
      itemCache.set(String(item.pageId), item);
    }
    return { items: body.items };
  } catch (error) {
    // Offline path: saved stories for this exact bucket (even expired)
    // beat a spinner in a dead zone. Only real data is ever served —
    // the failure itself is never cached as an answer.
    await listCache.hydrated;
    const saved = listCache.peek(key);
    if (saved) {
      return { items: saved.value, stale: true };
    }
    throw error;
  }
}

export function getCachedHistoryItem(pageId: number): HistoryItem | undefined {
  return itemCache.get(String(pageId));
}

/** Every story seen recently — the web of history links into them. */
export function getCachedHistoryItems(): HistoryItem[] {
  return itemCache.values();
}

/** Test seam. */
export function cacheHistoryItems(items: HistoryItem[]) {
  for (const item of items) {
    itemCache.set(String(item.pageId), item);
  }
}
