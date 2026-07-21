import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

/** The feed plus how it was gathered: `sparse` means the server found
 * a quiet corner and widened the Wikipedia search to fill it. */
export type HistoryFeed = { items: HistoryItem[]; sparse?: boolean };

// Same session-cache pattern as the places list: keyed on an ~11m grid,
// individual items kept for the detail screen.
const listCache = new Map<string, HistoryFeed>();
const itemCache = new Map<number, HistoryItem>();

function cacheKey(center: Coordinates): string {
  return `${center.latitude.toFixed(4)}|${center.longitude.toFixed(4)}`;
}

export async function fetchNearbyHistory(
  center: Coordinates,
  options?: { forceRefresh?: boolean }
): Promise<HistoryFeed> {
  const key = cacheKey(center);
  if (!options?.forceRefresh) {
    const cached = listCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
  });
  if (options?.forceRefresh) {
    params.set('fresh', '1'); // a deliberate pull must bypass the server's bucket cache too
  }

  const response = await fetch(apiUrl(`/api/history?${params}`));
  if (!response.ok) {
    throw new Error(`History request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { items: HistoryItem[]; sparse?: boolean };
  const feed: HistoryFeed = body.sparse ? { items: body.items, sparse: true } : { items: body.items };
  listCache.set(key, feed);
  for (const item of body.items) {
    itemCache.set(item.pageId, item);
  }
  return feed;
}

export function getCachedHistoryItem(pageId: number): HistoryItem | undefined {
  return itemCache.get(pageId);
}

/**
 * One story by pageId — the share deep-link cold start, where nothing
 * has populated the session cache yet. Null means the server is sure
 * there is no such story (a true 404); upstream trouble throws so the
 * caller can tell the difference.
 */
export async function fetchStory(pageId: number): Promise<HistoryItem | null> {
  const cached = itemCache.get(pageId);
  if (cached) {
    return cached;
  }

  const response = await fetch(apiUrl(`/api/story?pageId=${pageId}`));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Story request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { item: HistoryItem };
  itemCache.set(body.item.pageId, body.item);
  return body.item;
}

/** Every story seen this session — the web of history links into them. */
export function getCachedHistoryItems(): HistoryItem[] {
  return [...itemCache.values()];
}

/** Test seam. */
export function cacheHistoryItems(items: HistoryItem[]) {
  for (const item of items) {
    itemCache.set(item.pageId, item);
  }
}
