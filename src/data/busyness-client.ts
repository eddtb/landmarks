import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { BusynessPattern } from '@/types/busyness';
import { Place } from '@/types/place';

// One forecast per place per session; the server holds the month cache.
const busynessCache = new Map<string, BusynessPattern | null>();

export async function fetchBusyness(place: Place): Promise<BusynessPattern | null> {
  const cached = busynessCache.get(place.id);
  if (cached !== undefined) {
    return cached;
  }

  const params = new URLSearchParams({
    id: place.id,
    name: place.name,
    ...(place.primaryLabel ? { label: place.primaryLabel } : {}),
    ...(place.ratingCount ? { ratingCount: String(place.ratingCount) } : {}),
    address: place.address,
  });

  const response = await fetch(apiUrl(`/api/busyness?${params}`));
  if (!response.ok) {
    throw new Error(`Busyness request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { pattern: BusynessPattern | null };
  busynessCache.set(place.id, body.pattern);
  return body.pattern;
}
