import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

// Same session-cache pattern as the places list: keyed on an ~11m grid,
// individual items kept for the detail screen.
const listCache = new Map<string, HistoryItem[]>();
const itemCache = new Map<number, HistoryItem>();

function cacheKey(center: Coordinates): string {
  return `${center.latitude.toFixed(4)}|${center.longitude.toFixed(4)}`;
}

export async function fetchNearbyHistory(
  center: Coordinates,
  options?: { forceRefresh?: boolean }
): Promise<HistoryItem[]> {
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

  const response = await fetch(apiUrl(`/api/history?${params}`));
  if (!response.ok) {
    throw new Error(`History request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { items: HistoryItem[] };
  listCache.set(key, body.items);
  for (const item of body.items) {
    itemCache.set(item.pageId, item);
  }
  return body.items;
}

export function getCachedHistoryItem(pageId: number): HistoryItem | undefined {
  return itemCache.get(pageId);
}

/** Test seam. */
export function cacheHistoryItems(items: HistoryItem[]) {
  for (const item of items) {
    itemCache.set(item.pageId, item);
  }
}
