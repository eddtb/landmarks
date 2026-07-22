import { diskBackedMap } from '@/server/ai-cache';
import { fixturesEnabled, outageActive, readFixture } from '@/server/fixtures';
import { dressWithPhotos } from '@/server/geograph';
import {
  enrichStandaloneListed,
  fetchListedBuildings,
  fetchPlaques,
  mergeHistorySources,
} from '@/server/heritage';
import { resolvePlaqueSubjects } from '@/server/plaque-subject';
import { shouldWiden, SparseRadiusMeters } from '@/server/sparse';
import { ExistenceFacts, fetchExistenceFacts } from '@/server/wikidata';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryFeed, HistoryItem } from '@/types/history';
import { wikiTitleFromUrl } from '@/utils/format';
import { distanceMeters } from '@/utils/geo';

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
 *
 * Cold composes serve early (#201): once the story text is complete,
 * the response goes out flagged `dressing: true` while the decoration
 * legs (photos, existence tags) finish behind it — the client re-asks
 * once and collects the dressed verdict from this bucket's cache.
 */
const ListTtlMs = 60 * 60 * 1000;
// v6: items may carry event:true (Edd's ruling: articles ABOUT events
// — crashes, battles, fires — live in the History archive, never
// Nearby) — a v5 list lacks the flag and would keep leaking events
// into Nearby for its TTL;
// v5: entries may carry a sparse flag (the compose widened Wikipedia
// to 3000m) — and a v4 sparse-area entry was composed narrow, so it
// must not be replayed as if it were the honest wide list;
// v4: plaque items may carry resolved subject titles (option A);
// v3 and earlier predate photo rules and existence tags
const listCache = diskBackedMap<{ items: HistoryItem[]; sparse?: boolean; at: number }>(
  'history-lists-v6'
);

function bucketKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}`; // ~111m × ~70m at UK latitudes
}

// Serve-once state for a cold compose whose photo leg is still in
// flight: the text-complete list lives HERE, never in listCache — the
// disk cache may only ever hold the final dressed verdict. A request
// arriving inside the dressing window (the client's one-shot upgrade
// re-fetch, a second device) gets this snapshot again instead of
// re-firing four upstreams; the entry clears when the leg settles,
// success or failure alike.
const pendingCompose = new Map<string, { items: HistoryItem[]; sparse?: boolean }>();

// How long a cold compose waits for the decoration legs (photos +
// existence tags) before serving the text-complete list flagged
// `dressing: true`. Warm caches settle both legs well inside this;
// cold legs (measured 1.5-3.5s) never make it — and shouldn't.
const ServeGraceMs = 150;

/** Existence facts (tag + event verdict) keyed by pageId; failure
 * degrades to an empty map — fewer facts, never fewer stories. */
async function existenceFactsByPageId(items: HistoryItem[]): Promise<Map<number, ExistenceFacts>> {
  try {
    const wikiTitled = items.flatMap((item) => {
      const title = wikiTitleFromUrl(item.url);
      return title ? [[item, title] as const] : [];
    });
    const facts = await fetchExistenceFacts(wikiTitled.map(([, title]) => title));
    return new Map(
      wikiTitled.flatMap(([item, title]) =>
        facts.has(title) ? [[item.pageId, facts.get(title)!] as const] : []
      )
    );
  } catch (error) {
    console.warn('Existence facts degraded:', error);
    return new Map();
  }
}

function applyFacts(items: HistoryItem[], facts: Map<number, ExistenceFacts>): HistoryItem[] {
  if (facts.size === 0) {
    return items;
  }
  return items.map((item) => {
    const fact = facts.get(item.pageId);
    if (!fact) {
      return item;
    }
    return {
      ...item,
      ...(fact.tag ? { pastTag: fact.tag } : {}),
      ...(fact.event ? { event: true as const } : {}),
    };
  });
}

// The CI pin (and the fixtures' home): anything asked near here gets
// the dense Greenwich recording; anything far away gets the sparse
// one. 20km clears the FallbackCoordinates case (central London,
// ~9km) so a denied-location boot still sees the dense feed.
const FixturePin = { latitude: 51.4826, longitude: -0.0077 };
const SparseFixtureMeters = 20000;

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

  // Hermetic E2E: recorded payloads instead of upstreams — runner IPs
  // get 429'd by Wikipedia/Wikidata. Near the pinned simulator it's
  // the dense Greenwich feed; a faraway search (the sparse flow's
  // geocoded village) gets the sparse-area recording, falling back to
  // the dense one so a missing sparse fixture never blanks the app.
  // The outage flag (offline-stale flow) refuses first — a dead
  // network answers nobody. Flag off: this whole block is skipped and
  // the route is byte-identical to the live one.
  if (fixturesEnabled()) {
    if (outageActive()) {
      return Response.json({ error: 'Deliberate E2E outage' }, { status: 503 });
    }
    const sparseArea = distanceMeters(center, FixturePin) > SparseFixtureMeters;
    const fixture =
      (sparseArea ? readFixture<{ items: HistoryItem[] }>('history-sparse') : null) ??
      readFixture<{ items: HistoryItem[] }>('history');
    if (fixture) {
      return Response.json(fixture);
    }
  }

  // The photo verdict routes, it doesn't delete: the client puts
  // subject-photo stories in Nearby (findable on arrival — Edd's rule)
  // and the rest in the History archive. The server ships everything.
  const respond = (
    items: Awaited<ReturnType<typeof dressWithPhotos>>,
    sparse?: boolean,
    dressing?: boolean
  ) => {
    // The shared feed shape (src/types/history.ts): the horizon rides
    // with sparse so the client derives its "up to ~N min walk" copy
    // from what this compose actually searched — a radius change here
    // can no longer make the count line lie.
    const feed: HistoryFeed = {
      items,
      ...(sparse ? { sparse: true, horizon: SparseRadiusMeters } : {}),
      ...(dressing ? { dressing: true } : {}),
    };
    return Response.json(feed);
  };

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
    // A cold compose for this bucket is mid-dress: serve its snapshot
    // again (still flagged — the caller may re-ask once more later)
    // rather than re-firing the whole upstream fan-out
    const pending = pendingCompose.get(key);
    if (pending) {
      return respond(pending.items, pending.sparse, true);
    }
  }

  try {
    const sourcesStart = Date.now();
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
    const plaquesStart = Date.now();
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

    const enrichStart = Date.now();
    const told = await enrichStandaloneListed(merged);
    // The deep feed: everything within the walk, not a top-40 — the list
    // virtualises client-side, and photo lookups stay capped per request
    // (the deep tail warms up across requests), so length ≠ load time
    const capped = told.slice(0, 150);

    // The two remaining network stages hit DIFFERENT hosts (Commons +
    // Geograph vs Wikidata) — per-host politeness allows them to
    // overlap, so together they cost the longer of the two, not the
    // sum. The Wikipedia-bound stages above stay ordered: they share a
    // host AND enrichment consumes the merge that plaque resolution
    // feeds. And neither leg holds the response past the grace below:
    // measured cold (2026-07-22, Greenwich), tags are 3.5s and dressing
    // is deadline-bounded at 1.5s — both decoration (the eyebrow tag,
    // the thumbnail), neither worth staring at a spinner for. The story
    // text itself is complete at this point.
    const decorateStart = Date.now();
    const dressing = dressWithPhotos(capped);
    // Structured existence facts from Wikidata — grammar retired (#137's
    // ceiling); failure degrades (in the helper) to fewer tags, never
    // fewer stories
    let factsSoFar = new Map<number, ExistenceFacts>();
    const tagging = existenceFactsByPageId(capped).then((facts) => (factsSoFar = facts));

    // Cache only the final dressed verdict — the disk cache's bucket
    // answer must never be an undressed list
    const finalize = ([dressedItems, facts]: [HistoryItem[], Map<number, ExistenceFacts>]) => {
      const items = applyFacts(dressedItems, facts);
      listCache.set(key, sparse ? { items, sparse, at: Date.now() } : { items, at: Date.now() });
      return items;
    };

    const timings = () =>
      `sources ${plaquesStart - sourcesStart}ms, plaques+merge ${enrichStart - plaquesStart}ms, ` +
      `enrich ${decorateStart - enrichStart}ms, decorate ${Date.now() - decorateStart}ms` +
      ` (${capped.length} items, sparse=${sparse})`;

    // The grace: warm caches settle both legs in a few ms — answer
    // complete and unflagged, cached, done. A cold compose won't make
    // it; the text-complete list is served NOW and the dressed verdict
    // is cached when the legs land. A failed photo leg caches NOTHING:
    // couldn't-try is not tried-and-failed.
    const final = Promise.all([dressing, tagging]);
    const settled = await Promise.race([
      final,
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ServeGraceMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]).catch(() => null);
    if (settled) {
      console.log(`[history] cold compose ${key}: ${timings()}, decoration made the grace`);
      return respond(finalize(settled), sparse);
    }

    // Facts that beat the grace still ride the early response
    const snapshot = { items: applyFacts(capped, factsSoFar), ...(sparse ? { sparse } : {}) };
    pendingCompose.set(key, snapshot);
    const settle = () => {
      // Identity-checked like the client's in-flight map: a fresh=1
      // recompose may have replaced this entry — don't clear its snapshot
      if (pendingCompose.get(key) === snapshot) {
        pendingCompose.delete(key);
      }
    };
    final.then(
      (finished) => {
        finalize(finished);
        settle();
        console.log(
          `[history] dressed ${key}: decoration landed ${Date.now() - decorateStart}ms after start`
        );
      },
      (error) => {
        settle();
        console.warn('Photo dressing degraded (verdict not cached):', error);
      }
    );
    console.log(`[history] cold compose ${key}: ${timings()}, served undressed`);
    return respond(snapshot.items, sparse, true);
  } catch (error) {
    console.error('History lookup failed:', error);
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
