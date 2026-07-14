import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Server-side only. Finds the Wikipedia article for a place by searching
 * articles physically near its coordinates, then picking the best title
 * match — the nearest article is often about something else that happened
 * at the same spot.
 */

// Wikipedia asks API clients to identify themselves
const UserAgent = 'landmarks-app/1.0 (https://github.com/eddtb/landmarks; learning project)';

export type StoryResult = {
  story: string;
  title: string;
  url: string;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, '') // "St Paul's" must become "st pauls", not "st paul s"
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const NoiseWords = new Set(['the', 'a', 'an', 'of', 'and']);

function tokens(text: string): Set<string> {
  return new Set(
    normalize(text)
      .split(' ')
      .filter((word) => word && !NoiseWords.has(word))
  );
}

/**
 * Pick the candidate title that best matches the place name, or null when
 * nothing matches well enough — a random cafe must not get the story of
 * whatever article happens to be nearby.
 */
export function pickBestArticle(placeName: string, candidateTitles: string[]): string | null {
  const placeNormalized = normalize(placeName);
  const placeTokens = tokens(placeName);
  if (placeTokens.size === 0) {
    return null;
  }

  let best: { title: string; score: number } | null = null;

  for (const title of candidateTitles) {
    const titleNormalized = normalize(title);
    let score: number;

    if (titleNormalized === placeNormalized) {
      score = 1;
    } else if (
      titleNormalized.includes(placeNormalized) ||
      placeNormalized.includes(titleNormalized)
    ) {
      score = 0.85;
    } else {
      // Token overlap (Jaccard index)
      const titleTokens = tokens(title);
      const intersection = [...placeTokens].filter((token) => titleTokens.has(token)).length;
      const union = new Set([...placeTokens, ...titleTokens]).size;
      score = union === 0 ? 0 : intersection / union;
    }

    if (!best || score > best.score) {
      best = { title, score };
    }
  }

  // Below this, matches are coincidence, not identity
  return best && best.score >= 0.5 ? best.title : null;
}

type GeosearchResponse = {
  query?: { geosearch?: { title: string }[] };
};

type SummaryResponse = {
  type?: string;
  title?: string;
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
};

export async function findStory(
  placeName: string,
  coordinates: Coordinates
): Promise<StoryResult | null> {
  const geoUrl =
    'https://en.wikipedia.org/w/api.php?action=query&list=geosearch&format=json' +
    `&gscoord=${coordinates.latitude}%7C${coordinates.longitude}&gsradius=250&gslimit=10`;

  const geoResponse = await fetch(geoUrl, { headers: { 'User-Agent': UserAgent } });
  if (!geoResponse.ok) {
    throw new Error(`Wikipedia geosearch failed with status ${geoResponse.status}`);
  }
  const geo = (await geoResponse.json()) as GeosearchResponse;
  const candidates = geo.query?.geosearch?.map((entry) => entry.title) ?? [];

  const title = pickBestArticle(placeName, candidates);
  if (!title) {
    return null;
  }

  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summaryResponse = await fetch(summaryUrl, { headers: { 'User-Agent': UserAgent } });
  if (!summaryResponse.ok) {
    return null;
  }
  const summary = (await summaryResponse.json()) as SummaryResponse;

  // 'standard' excludes disambiguation pages and redirects-to-nowhere
  if (summary.type !== 'standard' || !summary.extract || !summary.title) {
    return null;
  }

  return {
    story: summary.extract,
    title: summary.title,
    url: summary.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${title}`,
  };
}

type GeosearchEntry = {
  pageid: number;
  title: string;
  lat: number;
  lon: number;
};

type BatchPage = {
  pageid: number;
  title: string;
  extract?: string;
  thumbnail?: { source?: string };
  fullurl?: string;
};

/** Pure assembly step, unit-testable without network. */
export function buildHistoryItems(
  entries: GeosearchEntry[],
  pages: Record<string, BatchPage>,
  center: Coordinates
): HistoryItem[] {
  const pagesById = new Map(Object.values(pages).map((page) => [page.pageid, page]));

  return entries
    .map((entry) => {
      const page = pagesById.get(entry.pageid);
      const coordinates = { latitude: entry.lat, longitude: entry.lon };
      return {
        pageId: entry.pageid,
        title: entry.title,
        coordinates,
        distanceMeters: distanceMeters(center, coordinates),
        extract: page?.extract || undefined,
        thumbnailUrl: page?.thumbnail?.source,
        url: page?.fullurl ?? `https://en.wikipedia.org/?curid=${entry.pageid}`,
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

/**
 * Wikipedia articles physically near the user — including things with no
 * business listing anywhere: vanished buildings, incidents, old boundaries.
 * One geosearch + one batch query for extracts/thumbnails/urls.
 */
export async function findNearbyHistory(
  center: Coordinates,
  radius = 1500
): Promise<HistoryItem[]> {
  const geoUrl =
    'https://en.wikipedia.org/w/api.php?action=query&list=geosearch&format=json' +
    `&gscoord=${center.latitude}%7C${center.longitude}&gsradius=${radius}&gslimit=20`;

  const geoResponse = await fetch(geoUrl, { headers: { 'User-Agent': UserAgent } });
  if (!geoResponse.ok) {
    throw new Error(`Wikipedia geosearch failed with status ${geoResponse.status}`);
  }
  const geo = (await geoResponse.json()) as { query?: { geosearch?: GeosearchEntry[] } };
  const entries = geo.query?.geosearch ?? [];
  if (entries.length === 0) {
    return [];
  }

  const pageIds = entries.map((entry) => entry.pageid).join('|');
  const batchUrl =
    'https://en.wikipedia.org/w/api.php?action=query&format=json' +
    `&pageids=${pageIds}` +
    '&prop=pageimages%7Cextracts%7Cinfo&exintro=1&explaintext=1&exlimit=max' +
    '&pithumbsize=800&pilimit=max&inprop=url';

  const batchResponse = await fetch(batchUrl, { headers: { 'User-Agent': UserAgent } });
  if (!batchResponse.ok) {
    throw new Error(`Wikipedia batch query failed with status ${batchResponse.status}`);
  }
  const batch = (await batchResponse.json()) as { query?: { pages?: Record<string, BatchPage> } };

  return buildHistoryItems(entries, batch.query?.pages ?? {}, center);
}
