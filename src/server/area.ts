import { diskBackedMap } from '@/server/ai-cache';
import { storeGet, storePut } from '@/server/telling-store';
import { fetchExistenceFacts } from '@/server/wikidata';
import { geosearchEntries } from '@/server/wikipedia';
import { feedBucketKey } from '@/types/history';
import { Coordinates } from '@/utils/geo';

/**
 * The name of the ground you are standing on, asked of Wikipedia
 * rather than of Apple's address fields.
 *
 * Apple's placemark taxonomy cannot be trusted to name an AREA. It put
 * the WARD in `subLocality` at Dorking ("Dorking North", #205) and it
 * puts the BOROUGH there across London — "Bromley" for Crystal Palace
 * Park, "Lewisham" for Sydenham (device-triaged, CoreLocation probed
 * directly at both). Both answers strand the gazetteer: the first has
 * no article at all, the second has the article of a town four miles
 * away, so the screen confidently tells the wrong place's story.
 *
 * So the geocoder stops being asked first. The nearest article that
 * Wikidata classes as an AREA is the name — and the classifier is the
 * one this codebase already trusts for routing: `isAreaArticle`, whose
 * verdict keeps broad geographic subjects out of the Nearby feed
 * (src/server/wikidata.ts). The articles the feed excludes for being
 * areas are exactly the articles that should NAME an area.
 *
 * Costs nothing extra in practice: the Wikidata verdicts are the same
 * 30-day cached ones the feed fetches for this bucket's 150 items, so
 * after a feed load this is one geosearch and a run of cache hits.
 * Wikipedia and Wikidata are keyless and unmetered — no budget
 * breaker applies (see the AI call-site table in AGENTS.md).
 *
 * Not universal, and honestly so: `AreaClassIds` is London-shaped
 * ('area of London' does the work), so Dorking's nearest 80 articles
 * yield NOTHING here — probed live. That is why this is one candidate
 * in a cascade and not a replacement for it: no verdict means the
 * caller falls through to the geocoder's own fields, exactly as before.
 */

// 3000m, not the feed's 1500m: an area article sits at its
// representative CENTRE, which from the edge of a large park is
// further away than any of the park's own landmarks.
const SearchRadiusMeters = 3000;
const SearchLimit = 200;
// How deep into the distance-sorted list to classify. 60 covers the
// densest ground probed (Sydenham's nearest area article ranked past
// 40 behind local POIs); the batches are cached and shared with the
// feed, so depth is cheap after the first ask.
const ClassifyDepth = 60;

const NameTtlMs = 30 * 24 * 60 * 60 * 1000;
// The name of ground does not change, so this TTL is about correcting
// OUR verdicts, not tracking the world.
const nameCache = diskBackedMap<{ name: string | null; at: number }>('area-names-v1', {
  ttlMs: NameTtlMs,
  maxEntries: 2000,
});
const AreaKind = 'area';

// Single-flight per bucket: three screens call useAreaName, and a cold
// bucket would otherwise fan the same geosearch out three times.
const inFlight = new Map<string, Promise<string | null>>();

async function resolve(center: Coordinates): Promise<string | null> {
  const entries = await geosearchEntries(center, SearchRadiusMeters, SearchLimit);
  const nearest = entries.slice(0, ClassifyDepth).map((entry) => entry.title);
  if (nearest.length === 0) {
    return null;
  }
  const facts = await fetchExistenceFacts(nearest);
  // geosearch answers nearest-first, so the FIRST area-classed title
  // is the nearest one — no distance arithmetic needed here.
  for (const title of nearest) {
    if (facts.get(title)?.area) {
      return title;
    }
  }
  // Nowhere nearby is a named area. A real verdict, and cacheable.
  return null;
}

/**
 * The nearest area article's title for this spot, or null when nowhere
 * nearby is a named area. Bucket-cached (~111m, the same bucket the
 * feed uses) in process, on disk, and in the durable store.
 *
 * THROWS when the upstreams could not be asked. A failure is not a
 * verdict — caching "no area here" because Wikipedia rate-limited us
 * would strand this bucket with the borough's name for thirty days.
 */
export async function findNearestArea(center: Coordinates): Promise<string | null> {
  const key = feedBucketKey(center.latitude, center.longitude);

  const cached = nameCache.get(key);
  if (cached && Date.now() - cached.at < NameTtlMs) {
    return cached.name;
  }
  const running = inFlight.get(key);
  if (running) {
    return running;
  }

  const attempt = (async () => {
    // Another isolate may have resolved this bucket already — the edge
    // runtime recycles constantly, so per-process memory alone means
    // nearly every reader pays for the lookup (the #231/#262 lesson).
    const stored = await storeGet<{ name: string | null }>(AreaKind, key);
    if (stored && Date.now() - stored.at < NameTtlMs) {
      nameCache.set(key, { name: stored.value.name, at: stored.at });
      return stored.value.name;
    }

    const name = await resolve(center);
    const at = Date.now();
    nameCache.set(key, { name, at });
    // Awaited, never floated: on the edge the isolate freezes at the
    // response and a floated write never lands. storePut is contracted
    // not to throw, and the store never gates a read.
    await storePut(AreaKind, key, { name }, at).catch(() => {});
    return name;
  })();

  inFlight.set(key, attempt);
  try {
    return await attempt;
  } finally {
    inFlight.delete(key);
  }
}
