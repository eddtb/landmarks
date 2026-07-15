import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { Place } from '@/types/place';
import { WhatsOnEvent } from '@/types/whats-on';

// One lookup per place per session; the server holds the long cache.
const whatsOnCache = new Map<string, WhatsOnEvent[]>();

export async function fetchWhatsOn(place: Place): Promise<WhatsOnEvent[]> {
  const cached = whatsOnCache.get(place.id);
  if (cached !== undefined) {
    return cached;
  }

  const params = new URLSearchParams({
    id: place.id,
    name: place.name,
    address: place.address,
  });

  const response = await fetch(apiUrl(`/api/whats-on?${params}`));
  if (!response.ok) {
    throw new Error(`What's-on request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { events: WhatsOnEvent[] };
  whatsOnCache.set(place.id, body.events);
  return body.events;
}
