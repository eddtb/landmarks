import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { TodayEvent } from '@/types/today';
import { Coordinates } from '@/utils/geo';

// One lookup per ~1km grid cell per session; the server holds the
// day-long cache shared across sessions.
const todayCache = new Map<string, TodayEvent[]>();

function cacheKey(center: Coordinates): string {
  return `${center.latitude.toFixed(2)}|${center.longitude.toFixed(2)}`;
}

export async function fetchTodayNearby(
  center: Coordinates,
  area: string | undefined,
  options?: { forceRefresh?: boolean }
): Promise<TodayEvent[]> {
  const key = cacheKey(center);
  if (!options?.forceRefresh) {
    const cached = todayCache.get(key);
    if (cached) {
      return cached;
    }
  }

  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
    ...(area ? { area } : {}),
  });

  const response = await fetch(apiUrl(`/api/today?${params}`));
  if (!response.ok) {
    throw new Error(`Today request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { events: TodayEvent[] };
  todayCache.set(key, body.events);
  return body.events;
}
