import { diskBackedMap } from '@/server/ai-cache';
import { mapWithLimit } from '@/server/concurrency';
import { findStory, StoryResult } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * The heritage layer: Historic England's National Heritage List and
 * Open Plaques, both keyless and free. Where a listed building or a
 * plaque is clearly the same place as a Wikipedia story, it enriches
 * that story's badge instead of echoing it as a second card.
 */

const NhleBase =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer';

// Synthetic pageId namespaces, far above real Wikipedia pageids —
// SyntheticPageIdBase in types/history.ts is the shared floor that
// the share deep-link path gates on
const ListedBuildingIdBase = 2_000_000_000;
const PlaqueIdBase = 3_000_000_000;

/** ~meters → degrees at this latitude, for bounding boxes. */
function boxAround(center: Coordinates, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    south: center.latitude - latDelta,
    north: center.latitude + latDelta,
    west: center.longitude - lngDelta,
    east: center.longitude + lngDelta,
  };
}

/** NHLE names arrive ALL CAPS — "CHURCH OF ST ALFEGE" reads as shouting. */
const SmallWords = new Set(['and', 'of', 'the', 'at', 'to', 'in', 'on', 'with']);
export function titleCaseName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && SmallWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

type NhleFeature = {
  attributes: { Name?: string; Grade?: string; ListEntry?: number };
  // Multipoint geometry: points[0] is [longitude, latitude] — NOT {x, y}
  geometry?: { points?: [number, number][] };
};

/** Pure and unit-tested against a recorded live response. */
export function buildListedBuildingItems(
  features: NhleFeature[],
  center: Coordinates
): HistoryItem[] {
  return features.flatMap((feature) => {
    const { Name, Grade, ListEntry } = feature.attributes;
    const point = feature.geometry?.points?.[0];
    if (!Name || !ListEntry || !point) {
      return [];
    }
    const coordinates = { latitude: point[1], longitude: point[0] };
    return [
      {
        pageId: ListedBuildingIdBase + ListEntry,
        title: titleCaseName(Name),
        coordinates,
        distanceMeters: distanceMeters(center, coordinates),
        extract: `Grade ${Grade ?? 'II'} listed building on the National Heritage List for England.`,
        url: `https://historicengland.org.uk/listing/the-list/list-entry/${ListEntry}`,
        source: `Historic England · Grade ${Grade ?? 'II'}`,
      },
    ];
  });
}

export async function fetchListedBuildings(
  center: Coordinates,
  radius = 1000
): Promise<HistoryItem[]> {
  const box = boxAround(center, radius);
  const geometry = JSON.stringify({
    xmin: box.west,
    ymin: box.south,
    xmax: box.east,
    ymax: box.north,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Name,Grade,ListEntry',
    returnGeometry: 'true',
    // No spatial ordering exists server-side, and dense areas hold far
    // more listed buildings than any small cap — a low cap returns an
    // ARBITRARY subset (measured: it dropped the Grade I Cutty Sark
    // while keeping Grade II houses). Fetch the area, sort by distance
    // ourselves; the merge cap keeps the list small.
    resultRecordCount: '500',
    f: 'json',
  });
  const response = await fetch(`${NhleBase}/0/query?${params}`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`NHLE query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { features?: NhleFeature[] };
  return buildListedBuildingItems(body.features ?? [], center);
}

type Plaque = {
  id: number;
  latitude?: number;
  longitude?: number;
  inscription?: string;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * The name a plaque is filed under, when the inscription states one.
 *
 * A plaque's title used to be the first sixty characters of its own
 * inscription — "Jimi Hendrix 1942-1970 guitarist and songwriter lived
 * here…" — which is a sentence fragment, not a name. That went unnoticed
 * for as long as the title had nowhere to render (#292); the moment the
 * name reaches the screen it has to be a name.
 *
 * The subject is NOT available to ask for. Open Plaques' box query — one
 * call for a whole area, the only one the feed makes — answers with four
 * fields: id, latitude, longitude, inscription. `subjects`, `title` and
 * `address` live on /plaques/<id>.json, one HTTP call per plaque and
 * dozens per cold feed: the same egress bill enrichStandaloneListed
 * already had to bound at four-at-a-time, spent on every plaque rather
 * than the few that matter. So the name comes from the inscription.
 *
 * It comes from the one place a name is reliably found there.
 * Commemorative plaques open by naming who they commemorate and close
 * that clause with a lifespan: "AUDREY HEPBURN 1929–1993 Actress…",
 * "Sir John Betjeman 1906-1984 Poet Laureate…", "WINIFRED ATWELL d.1983
 * Pianist…". Capitalised words, then a year. Nothing else is claimed —
 * the moment prose starts before a lifespan closes the clause, this
 * abstains and the inscription's own opening words stand as before.
 *
 * Measured against 160 live plaques across eight British cities: it
 * names 40 of them and every name it takes is the subject. The other 120
 * mostly have no single subject to name ("This gateway marks the
 * position of the north bank of the…"). A fragment is honest; a guessed
 * name is not, and this file has no business inventing one.
 */
// A YEAR, not any number: "Detective Constable 0144 John Raymond Coker"
// carries a service number, and reading it as a lifespan would file the
// man under his rank.
const LifespanYear = /(?:^|\D)(?:1\d{3}|20\d{2})(?:\D|$)/;
// A name, not a sentence: four words holds "Sir Arthur Conan Doyle" and
// refuses "Turner House Artists Alfred Turner RA".
const MaxNameWords = 4;
// A clause that opens with one of these is a preamble, not a name — "In
// September 1767 Olaudah Equiano c.1745-1797" names the man second.
// The dedication VERBS are here too: old plaques set whole clauses in
// Title Case, and "Founded Here 1897", "Restored By The Parish 1901"
// and "Opened By Queen Victoria 1887" all read as capitalised-words-
// then-a-year. A clause that opens with what was DONE is about the
// doing, not a name — reviewed adversarially, these three were the
// probes that made the rule guess.
const PreambleWords = new Set([
  'in', 'on', 'at', 'to', 'of', 'the', 'this', 'these', 'near', 'here',
  'from', 'by', 'a', 'an', 'and', 'site', 'erected', 'memory', 'honour',
  'founded', 'built', 'rebuilt', 'opened', 'restored', 'unveiled',
  'established', 'dedicated', 'remembered',
]);
const startsCapital = (word: string) => /^[^\p{L}]*\p{Lu}/u.test(word);
// A WORD that shouts: two or more capitals, letters only. Judged per
// word, not per name — "W.H. SMITH" and "CAPTAIN W.E. JOHNS" mix
// initials with shouting, and the old whole-name test waved both
// through untouched. Dotted initials ("W.H.", "C.H.") and regnal
// numerals ("GEORGE IV"'s IV) keep their own case.
const shoutingWord = /^\p{Lu}{2,}$/u;
const romanNumeral = /^[IVXLCDM]+$/;

/** Quiet the shouting words, one by one, and leave the rest alone. */
function quietShouting(name: string): string {
  return name
    .split(' ')
    .map((word) =>
      shoutingWord.test(word) && !romanNumeral.test(word) ? titleCaseName(word) : word
    )
    .join(' ');
}

export function plaqueSubjectName(inscription: string): string | null {
  const words = collapse(inscription).split(' ').filter(Boolean);
  // A plaque that opens with a number opens with an occasion, not a
  // person: "400 Year Celebration 1625 - 2025 St. Oliver Plunkett."
  if (words.length === 0 || /\d/.test(words[0])) {
    return null;
  }
  let run: string[] = [];
  for (const word of words) {
    if (/\d/.test(word)) {
      const opener = run[0]?.toLowerCase().replace(/[^\p{L}]/gu, '') ?? '';
      if (
        LifespanYear.test(word) &&
        run.length >= 2 &&
        run.length <= MaxNameWords &&
        !PreambleWords.has(opener)
      ) {
        const name = run.join(' ').replace(/[,;:]+$/, '');
        return quietShouting(name);
      }
      run = [];
      continue;
    }
    if (startsCapital(word)) {
      run.push(word);
      continue;
    }
    // Prose began before any lifespan closed a name: nothing on this
    // plaque is certainly a name, so nothing is claimed.
    return null;
  }
  return null;
}

/** The name the inscription states, or its first 60 chars, whole words. */
export function plaqueTitle(inscription: string): string {
  const clean = collapse(inscription);
  const named = plaqueSubjectName(clean);
  if (named) {
    return named;
  }
  if (clean.length <= 60) {
    return clean;
  }
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Pure and unit-tested against a recorded live response. */
export function buildPlaqueItems(plaques: Plaque[], center: Coordinates): HistoryItem[] {
  return plaques.flatMap((plaque) => {
    if (!plaque.inscription || plaque.latitude == null || plaque.longitude == null) {
      return [];
    }
    const coordinates = { latitude: plaque.latitude, longitude: plaque.longitude };
    return [
      {
        pageId: PlaqueIdBase + plaque.id,
        title: plaqueTitle(plaque.inscription),
        coordinates,
        distanceMeters: distanceMeters(center, coordinates),
        extract: collapse(plaque.inscription),
        url: `https://openplaques.org/plaques/${plaque.id}`,
        source: 'Open Plaques',
      },
    ];
  });
}

export async function fetchPlaques(center: Coordinates, radius = 1000): Promise<HistoryItem[]> {
  const box = boxAround(center, radius);
  // box=[north,west],[south,east] — verified live 2026-07-20
  const url =
    'https://openplaques.org/plaques.json' +
    `?box=[${box.north},${box.west}],[${box.south},${box.east}]`;
  // One sick upstream must never hang the feed (measured: 20s+) — degrade to fewer stories
  const response = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) {
    throw new Error(`Open Plaques query failed with status ${response.status}`);
  }
  return buildPlaqueItems((await response.json()) as Plaque[], center);
}

/** Same-place test: close by, and sharing a meaningful part of the name. */
const NoiseTokens = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'church', 'house', 'building']);
function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !NoiseTokens.has(word))
  );
}

function samePlace(a: HistoryItem, b: HistoryItem, maxMeters: number): boolean {
  if (distanceMeters(a.coordinates, b.coordinates) > maxMeters) {
    return false;
  }
  const aTokens = nameTokens(a.title);
  const bTokens = nameTokens(`${b.title} ${b.extract ?? ''}`);
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  return shared >= 2 || (aTokens.size > 0 && [...aTokens].every((token) => bTokens.has(token)));
}

/**
 * One place, one card: a heritage record that matches a Wikipedia
 * story enriches its badge ("Wikipedia · Grade I listed"); the rest
 * stand as their own stories. Wikipedia wins because its extract can
 * be told.
 */
export function mergeHistorySources(
  wikipedia: HistoryItem[],
  listed: HistoryItem[],
  plaques: HistoryItem[],
  cap = 40
): HistoryItem[] {
  const enriched = wikipedia.map((item) => ({ ...item }));

  // A cathedral matches a dozen register records; the badge must read
  // "Grade I listed" once, not the whole dozen — keep only the best
  const gradeRank: Record<string, number> = { 'Grade I': 3, 'Grade II*': 2, 'Grade II': 1 };
  const bestGrade = new Map<HistoryItem, string>();
  const plaqued = new Set<HistoryItem>();

  // Any grade may enrich a story's badge, but only the notable grades
  // (I and II*, ~8% of the register) earn standalone cards — a feed of
  // anonymous Grade II terraces is the station-articles problem again
  const notableGrade = /Grade (I|II\*)$/;
  const standaloneListed = listed.filter((building) => {
    const match = enriched.find((story) => samePlace(story, building, 100));
    if (match) {
      const grade = building.source.split(' · ')[1] ?? 'Grade II';
      const current = bestGrade.get(match);
      if (!current || (gradeRank[grade] ?? 0) > (gradeRank[current] ?? 0)) {
        bestGrade.set(match, grade);
      }
      return false;
    }
    return notableGrade.test(building.source);
  });

  const standalonePlaques = plaques.filter((plaque) => {
    // A plaque within arm's reach of a story is ON that thing, whatever
    // its inscription's wording ("This tunnel constructed by…" shares no
    // name tokens with "Greenwich foot tunnel"); further out, the name
    // must agree
    const match = enriched.find(
      (story) =>
        distanceMeters(story.coordinates, plaque.coordinates) <= 30 ||
        samePlace(story, plaque, 75)
    );
    if (match) {
      plaqued.add(match);
      return false;
    }
    return true;
  });

  for (const story of enriched) {
    const grade = bestGrade.get(story);
    if (grade) {
      story.source = `${story.source} · ${grade} listed`;
    }
    if (plaqued.has(story)) {
      story.source = `${story.source} · plaque`;
    }
  }

  return [...enriched, ...standaloneListed, ...standalonePlaques]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}

/**
 * A standalone register card is thin — one line, no photo — but the
 * building often has its own Wikipedia article that simply didn't make
 * the user's 20-nearest (measured: the Cutty Sark, from anywhere but
 * right beside it). Ask at the BUILDING's coordinates instead; a match
 * upgrades the card to the full story. Cached per list entry — the
 * article for a listed building doesn't move when the user does.
 */
const StoryTtlMs = 7 * 24 * 60 * 60 * 1000;
const storyCache = diskBackedMap<{ story: StoryResult | null; at: number }>('nhle-stories', {
  ttlMs: StoryTtlMs,
  maxEntries: 2000,
});

// Each uncached enrichment is up to two Wikipedia calls, and a dense
// listed-building area brings dozens — an unbounded Promise.all here
// opened that many sockets at once and got the worker's egress
// rate-limited, which surfaces as the NEXT reader's feed 502ing.
// Four at a time still finishes a cold area inside the compose budget.
const EnrichConcurrency = 4;

export async function enrichStandaloneListed(items: HistoryItem[]): Promise<HistoryItem[]> {
  const resolved = await mapWithLimit(items, EnrichConcurrency, async (item) => {
      if (!item.source.startsWith('Historic England')) {
        return item;
      }
      const key = String(item.pageId);
      let cached = storyCache.get(key);
      if (!cached || Date.now() - cached.at > StoryTtlMs) {
        try {
          cached = { story: await findStory(item.title, item.coordinates), at: Date.now() };
          storyCache.set(key, cached);
        } catch {
          return null; // not cached — next request retries the lookup
        }
      }
      if (!cached.story) {
        // Story or no card: a register line with nothing to tell is a
        // record, not a story — its only job is badging (Edd's call)
        return null;
      }
      const grade = item.source.split(' · ')[1] ?? 'listed';
      return {
        ...item,
        extract: cached.story.story,
        url: cached.story.url,
        thumbnailUrl: item.thumbnailUrl ?? cached.story.thumbnailUrl,
        // Same badge shape as a direct merge — the reader can't tell
        // which side of the join found the story first
        source: `Wikipedia · ${grade} listed`,
      };
    }
  );
  // A big site holds several register records (measured: the National
  // Maritime Museum), and each can resolve to the SAME article — one
  // card per article URL, nearest wins
  const seenUrls = new Set<string>();
  return resolved.filter((item): item is HistoryItem => {
    if (item === null) {
      return false;
    }
    if (seenUrls.has(item.url)) {
      return false;
    }
    seenUrls.add(item.url);
    return true;
  });
}
