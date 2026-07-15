import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { Place } from '@/types/place';

// One lookup per place per session; the server holds the month cache.
const blurbCache = new Map<string, string | null>();

export async function fetchBlurb(place: Place): Promise<string | null> {
  const cached = blurbCache.get(place.id);
  if (cached !== undefined) {
    return cached;
  }

  const params = new URLSearchParams({
    id: place.id,
    name: place.name,
    ...(place.primaryLabel ? { label: place.primaryLabel } : {}),
    address: place.address,
  });

  const response = await fetch(apiUrl(`/api/blurb?${params}`));
  if (!response.ok) {
    throw new Error(`Blurb request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { blurb: string | null };
  blurbCache.set(place.id, body.blurb);
  return body.blurb;
}
