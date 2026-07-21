import { diskBackedMap } from '@/server/ai-cache';
import { fixturesEnabled, readFixture } from '@/server/fixtures';
import { dressWithPhotos } from '@/server/geograph';
import {
  enrichStandaloneListed,
  fetchListedBuildings,
  fetchPlaques,
  mergeHistorySources,
} from '@/server/heritage';
import { resolvePlaqueSubjects } from '@/server/plaque-subject';
import { shouldWiden, SparseRadiusMeters } from '@/server/sparse';
import { fetchExistenceTags } from '@/server/wikidata';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';
import { wikiTitleFromUrl } from '@/utils/format';

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
// v5: entries may carry a sparse flag (the compose widened Wikipedia
// to 3000m) — and a v4 sparse-area entry was composed narrow, so it
// must not be replayed as if it were the honest wide list;
// v4: plaque items may carry resolved subject titles (option A);
// v3 and earlier predate photo rules and existence tags
const listCache = diskBackedMap<{ items: HistoryItem[]; sparse?: boolean; at: number }>(
  'history-lists-v5'
);

function bucketKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}`; // ~111m × ~70m at UK latitudes
}

export async function GET(request: Request) {
  // Hermetic E2E: recorded Greenwich payload regardless of coords
  // (CI pins the simulator there) — runner IPs get 429'd upstream
  if (fixturesEnabled()) {
    const fixture = readFixture<{ items: HistoryItem[] }>('history');
    if (fixture) {
      return Response.json(fixture);
    }
  }

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
  const respond = (items: Awaited<ReturnType<typeof dressWithPhotos>>, sparse?: boolean) =>
    Response.json(sparse ? { items, sparse: true, horizon: SparseRadiusMeters } : { items });

  const key = bucketKey(lat, lng);
  if (!fresh) {
    const cached = listCache.get(key);
    if (cached && Date.now() - cached.at < ListTtlMs) {
      // Re-dress from the photo cache only (zero lookups): background
      // lookups that finished since the list was cached land here
      const items = await dressWithPhotos(cached.items, undefined, undefined, 0, 0);
      // …and quietly warm the still-unverdicted tail for the next request
      void dressWithPhotos(cached.items).catch(() => {});
      return respond(items, cached.sparse);
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
    // Plaques resolve their real subject first (evidence-gated: the
    // article must be geolocated at the plaque and named in the
    // inscription) so Deptford Creek earns a Gazetteer, not a stub
    const resolvedPlaques = await resolvePlaqueSubjects(
      plaques.status === 'fulfilled' ? plaques.value : [],
      wikipedia.value
    );

    let merged = mergeHistorySources(
      wikipedia.value,
      listed.status === 'fulfilled' ? listed.value : [],
      resolvedPlaques,
      200
    );

    // Sparse-area mode: a thin merge means a quiet corner, not a bug —
    // re-ask Wikipedia at the wide horizon and re-merge with the SAME
    // heritage results (their radii stay; only Wikipedia widens). A
    // failed widening degrades to the narrow list, never to an error.
    let sparse = false;
    if (shouldWiden(merged.length)) {
      try {
        const widened = await findNearbyHistory(center, SparseRadiusMeters);
        merged = mergeHistorySources(
          widened,
          listed.status === 'fulfilled' ? listed.value : [],
          resolvedPlaques,
          200
        );
        sparse = true;
      } catch (error) {
        console.warn('Sparse widening degraded:', error);
      }
    }

    const told = await enrichStandaloneListed(merged);
    // The deep feed: everything within the walk, not a top-40 — the list
    // virtualises client-side, and photo lookups stay capped per request
    // (the deep tail warms up across requests), so length ≠ load time
    const dressed = await dressWithPhotos(told.slice(0, 150));
    // Structured existence facts from Wikidata — grammar retired (#137's
    // ceiling); failure degrades to fewer tags, never fewer stories
    let items = dressed;
    try {
      const wikiTitled = dressed.flatMap((item) => {
        const title = wikiTitleFromUrl(item.url);
        return title ? [[item, title] as const] : [];
      });
      const tags = await fetchExistenceTags(wikiTitled.map(([, title]) => title));
      const tagByPageId = new Map(
        wikiTitled.flatMap(([item, title]) =>
          tags.has(title) ? [[item.pageId, tags.get(title)!] as const] : []
        )
      );
      items = dressed.map((item) =>
        tagByPageId.has(item.pageId) ? { ...item, pastTag: tagByPageId.get(item.pageId) } : item
      );
    } catch (error) {
      console.warn('Existence facts degraded:', error);
    }
    listCache.set(key, sparse ? { items, sparse, at: Date.now() } : { items, at: Date.now() });
    return respond(items, sparse);
  } catch (error) {
    console.error('History lookup failed:', error);
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
