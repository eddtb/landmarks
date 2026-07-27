import { backgroundWorkSurvives, diskBackedMap } from '@/server/ai-cache';
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
import { storeGet, storePut } from '@/server/telling-store';
import { ExistenceFacts, fetchExistenceFacts } from '@/server/wikidata';
import { findNearbyHistory } from '@/server/wikipedia';
import { feedBucketKey, HistoryFeed, HistoryItem } from '@/types/history';
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
// v7: items may carry area:true (broad geographic subjects stay in the
// Gazetteer but never become walk-to Nearby cards);
// v6: items may carry event:true (Edd's ruling: articles ABOUT events
// — crashes, battles, fires — live in the History archive, never
// Nearby) — a v5 list lacks the flag and would keep leaking events
// into Nearby for its TTL;
// v5: entries may carry a sparse flag (the compose widened Wikipedia
// to 3000m) — and a v4 sparse-area entry was composed narrow, so it
// must not be replayed as if it were the honest wide list;
// v4: plaque items may carry resolved subject titles (option A);
// v3 and earlier predate photo rules and existence tags
type CachedList = { items: HistoryItem[]; sparse?: boolean; at: number };
const listCache = diskBackedMap<CachedList>('history-lists-v7');

/**
 * The durable half of the same cache. The map above is per-process,
 * and on the production edge runtime that means per-ISOLATE: isolates
 * recycle constantly, so a "1 hour" bucket was in practice minutes
 * long and nearly every reader paid for a full four-upstream compose
 * (measured: 2-6s warm-looking, 8-11s under load, and enough
 * Wikipedia traffic to get the worker's egress rate-limited — which
 * the app reports, honestly, as "you're offline").
 *
 * The tellings solved this in #231 with a Turso store; the feed never
 * got the same treatment. It does now, under the same iron rule: the
 * store NEVER gates a read. Absent config, unreachable, corrupt — all
 * answer "not stored" and the compose proceeds exactly as before.
 */
const FeedKind = 'feed';


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

/** Existence facts (tag + event + broad-area verdicts) keyed by pageId; failure
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
      ...(fact.area ? { area: true as const } : {}),
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

  const key = feedBucketKey(lat, lng);
  if (!fresh) {
    const cached = listCache.get(key);
    if (cached && Date.now() - cached.at < ListTtlMs) {
      // Re-dress from the photo cache only (zero lookups): background
      // lookups that finished since the list was cached land here
      const items = await dressWithPhotos(cached.items, undefined, undefined, 0, 0);
      if (backgroundWorkSurvives) {
        // …and quietly warm the still-unverdicted tail for the next
        // request — only where a floated promise actually finishes
        void dressWithPhotos(cached.items).catch(() => {});
      }
      return respond(items, cached.sparse);
    }
    // A cold compose for this bucket is mid-dress: serve its snapshot
    // again (still flagged — the caller may re-ask once more later)
    // rather than re-firing the whole upstream fan-out
    const pending = pendingCompose.get(key);
    if (pending) {
      return respond(pending.items, pending.sparse, true);
    }
    // Another isolate may have composed this bucket already. A hit
    // re-seeds the map at its ORIGINAL age, so the hour is counted
    // from the compose, not from this worker's luck.
    const stored = await storeGet<CachedList>(FeedKind, key);
    if (stored && Date.now() - stored.at < ListTtlMs) {
      listCache.set(key, { ...stored.value, at: stored.at });
      const items = await dressWithPhotos(stored.value.items, undefined, undefined, 0, 0);
      return respond(items, stored.value.sparse);
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
    // These two legs ran abreast for a few hours (#240, chasing 1-2.5s
    // off a cold compose) and it cost more than it bought: enrichment
    // and the facts lookup both hammer Wikipedia, and overlapping them
    // doubled the peak fan-out at a keyless upstream. Measured against
    // production afterwards: 8 of 12 feed requests came back 502 —
    // Wikipedia rate-limiting the worker's egress, which the client
    // reads as "you're offline". Sequential politeness is the standing
    // rule for keyless upstreams and it outranks the seconds.
    const told = await enrichStandaloneListed(merged);
    // The deep feed: everything within the walk, not a top-40 — the list
    // virtualises client-side, and photo lookups stay capped per request
    // (the deep tail warms up across requests), so length ≠ load time
    const capped = told.slice(0, 150);

    // Classification is routing, not decoration: it must settle before
    // ANY payload is allowed out, otherwise a cold Wikidata lookup can
    // briefly paint Deptford as a walk-to destination before the
    // dressing upgrade removes it. Failure still degrades to no facts,
    // but a successful area/event verdict is atomic with the response.
    // Photos remain cosmetic and retain the fast-response grace below.
    const decorateStart = Date.now();
    const facts = await existenceFactsByPageId(capped);
    const classified = applyFacts(capped, facts);
    // The edge awaits this leg (below), so every lookup it starts
    // actually completes — where the Node path floats them and the
    // deadline drops the tail. Twenty completing lookups is another
    // forty sockets at Commons and Geograph on top of the compose;
    // half as many still warms the feed across requests.
    const dressing = backgroundWorkSurvives
      ? dressWithPhotos(classified)
      : dressWithPhotos(classified, undefined, undefined, undefined, 10);

    // Cache only the final dressed verdict — the disk cache's bucket
    // answer must never be an undressed list
    const finalize = ([dressedItems, facts]: [HistoryItem[], Map<number, ExistenceFacts>]) => {
      const items = applyFacts(dressedItems, facts);
      const entry: CachedList = sparse
        ? { items, sparse, at: Date.now() }
        : { items, at: Date.now() };
      listCache.set(key, entry);
      // The durable twin, so the NEXT isolate inherits this compose
      // instead of repeating it. Fire-and-forget would be wrong on
      // the edge (frozen at response) and unnecessary on Node — the
      // callers below await it where it matters.
      return { items, stored: storePut(FeedKind, key, entry, entry.at) };
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
    const final = Promise.all([dressing, Promise.resolve(facts)]);

    // On the edge worker the serve-early bargain is a lie: the floated
    // finalize dies with the isolate (#232), the dressed verdict never
    // caches, and the dressing:true snapshot re-serves forever. There
    // the response waits for the photo leg it would have floated —
    // bounded by dressWithPhotos' own deadline, so ≤ ~1.5s, once per
    // bucket per isolate.
    if (!backgroundWorkSurvives) {
      try {
        const finished = await final;
        const { items, stored } = finalize(finished);
        // Awaited: the isolate freezes the moment this response
        // returns, and a write that never lands leaves the next
        // reader composing from scratch — the whole point of the store.
        // Swallowed: the store never gates a read (its iron rule), and
        // a rejected write must not turn a complete feed into a
        // degraded one. storePut is contracted not to throw; this is
        // the belt, and a test pins it.
        await stored.catch(() => {});
        console.log(`[history] cold compose ${key}: ${timings()}, awaited dressing (edge)`);
        return respond(items, sparse);
      } catch (error) {
        console.warn('Photo dressing degraded (verdict not cached):', error);
        return respond(classified, sparse, true);
      }
    }
    const settled = await Promise.race([
      final,
      new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), ServeGraceMs);
        (timer as { unref?: () => void }).unref?.();
      }),
    ]).catch(() => null);
    if (settled) {
      console.log(`[history] cold compose ${key}: ${timings()}, decoration made the grace`);
      const { items, stored } = finalize(settled);
      // Awaited on EVERY runtime, not just the one we think we're on.
      // The whole durable cache existed for hours without writing a
      // single row because it sat behind a runtime check that silently
      // read the wrong way; a write worth making is worth the ~150ms
      // wherever we are.
      await stored.catch(() => {});
      return respond(items, sparse);
    }

    const snapshot = { items: classified, ...(sparse ? { sparse } : {}) };
    pendingCompose.set(key, snapshot);
    const settle = () => {
      // Identity-checked like the client's in-flight map: a fresh=1
      // recompose may have replaced this entry — don't clear its snapshot
      if (pendingCompose.get(key) === snapshot) {
        pendingCompose.delete(key);
      }
    };
    final.then(
      async (finished) => {
        await finalize(finished).stored.catch(() => {});
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
    // A refused compose is not an empty world. Wikipedia rate-limits
    // by egress IP, so one worker's busy minute becomes every reader's
    // error — and the app says "you're offline" to someone who isn't.
    // A stored feed past its hour is stale, not wrong: the ground
    // doesn't change in an hour, and yesterday's stories beat a dead
    // screen. Only a bucket we have never composed can honestly 502.
    const salvaged = await storeGet<CachedList>(FeedKind, key);
    if (salvaged) {
      console.log(`[history] compose refused for ${key} — serving the stored feed instead`);
      return respond(salvaged.value.items, salvaged.value.sparse);
    }
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
