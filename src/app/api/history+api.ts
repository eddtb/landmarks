import { diskBackedMap } from '@/server/ai-cache';
import { dressWithPhotos } from '@/server/geograph';
import {
  enrichStandaloneListed,
  fetchListedBuildings,
  fetchPlaques,
  mergeHistorySources,
} from '@/server/heritage';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';

/**
 * GET /api/history?lat=51.5&lng=-0.09[&fresh=1]
 *
 * The stories of where you stand: Wikipedia is the backbone, Historic
 * England and Open Plaques enrich or extend it, Geograph dresses the
 * unillustrated. All upstreams keyless or free-keyed; a missing or
 * slow heritage source degrades to fewer stories, never to an error.
 *
 * The composed feed is cached per ~100m area bucket for an hour —
 * TTLs govern re-asking about the SAME spot, movement always busts
 * (the standing location-first rule). Pull-to-refresh sends fresh=1
 * and bypasses the read.
 */
const ListTtlMs = 60 * 60 * 1000;
const listCache = diskBackedMap<{ items: HistoryItem[]; at: number }>('history-lists');

function bucketKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}`; // ~111m × ~70m at UK latitudes
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  const fresh = url.searchParams.get('fresh') === '1';

  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Expected lat and lng' }, { status: 400 });
  }
  const center = { latitude: lat, longitude: lng };

  // The photo verdict routes, it doesn't delete: the client puts
  // subject-photo stories in Nearby (findable on arrival — Edd's rule)
  // and the rest in the History archive. The server ships everything.
  const respond = (items: Awaited<ReturnType<typeof dressWithPhotos>>) =>
    Response.json({ items });

  const key = bucketKey(lat, lng);
  if (!fresh) {
    const cached = listCache.get(key);
    if (cached && Date.now() - cached.at < ListTtlMs) {
      // Re-dress from the photo cache only (zero lookups): background
      // lookups that finished since the list was cached land here
      const items = await dressWithPhotos(cached.items, undefined, undefined, 0, 0);
      // …and quietly warm the still-unverdicted tail for the next request
      void dressWithPhotos(cached.items).catch(() => {});
      return respond(items);
    }
  }

  try {
    const [wikipedia, listed, plaques] = await Promise.allSettled([
      findNearbyHistory(center),
      fetchListedBuildings(center),
      fetchPlaques(center),
    ]);

    // Wikipedia is the backbone — without it there is no screen
    if (wikipedia.status === 'rejected') {
      throw wikipedia.reason;
    }
    for (const settled of [listed, plaques]) {
      if (settled.status === 'rejected') {
        console.warn('History source degraded:', settled.reason);
      }
    }

    // Merge generously, THEN drop the story-less register cards, THEN
    // cap — so a dropped gate-pier backfills with a real story instead
    // of shrinking the feed
    const merged = mergeHistorySources(
      wikipedia.value,
      listed.status === 'fulfilled' ? listed.value : [],
      plaques.status === 'fulfilled' ? plaques.value : [],
      200
    );
    const told = await enrichStandaloneListed(merged);
    // The deep feed: everything within the walk, not a top-40 — the list
    // virtualises client-side, and photo lookups stay capped per request
    // (the deep tail warms up across requests), so length ≠ load time
    const items = await dressWithPhotos(told.slice(0, 150));
    listCache.set(key, { items, at: Date.now() });
    return respond(items);
  } catch (error) {
    console.error('History lookup failed:', error);
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
