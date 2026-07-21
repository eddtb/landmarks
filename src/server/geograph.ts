import { diskBackedMap } from '@/server/ai-cache';
import { findCommonsPhoto, matchTokens, StoryPhoto } from '@/server/commons';
import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Geograph photographs essentially every hundred-metre square of
 * Britain, CC BY-SA. Requires the free GEOGRAPH_API_KEY — and a
 * missing key is an ERROR, not an empty result: a keyless process
 * once cached 'no photo' verdicts for a week (the null poisoned the
 * cache long after the key arrived).
 */

const Endpoint = 'https://api.geograph.org.uk/syndicator.php';

export type GeographPhoto = {
  title: string;
  latitude: number;
  longitude: number;
  imageUrl: string;
  credit: string;
};

type SyndicatorItem = {
  title?: string;
  guid?: string;
  author?: string;
  lat?: number;
  long?: number;
  thumb?: string;
};

/** "…_120x120.jpg" is the thumbnail; the suffix-free URL is the full frame. */
export function fullSizeUrl(thumb: string): string {
  return thumb.replace(/_\d+x\d+\.jpg$/, '.jpg');
}

/** Pure and unit-tested against a recorded live response. */
export function buildPhotos(items: SyndicatorItem[]): GeographPhoto[] {
  return items.flatMap((item) => {
    if (item.lat == null || item.long == null || !item.thumb) {
      return [];
    }
    return [
      {
        title: item.title ?? '',
        latitude: item.lat,
        longitude: item.long,
        imageUrl: fullSizeUrl(item.thumb),
        // CC BY-SA: the author's name travels with the picture
        credit: `Photo: ${item.author ?? 'Geograph contributor'} / Geograph (CC BY-SA)`,
      },
    ];
  });
}

export async function fetchAreaPhotos(center: Coordinates, perpage = 10): Promise<GeographPhoto[]> {
  const key = process.env.GEOGRAPH_API_KEY;
  if (!key) {
    throw new Error('GEOGRAPH_API_KEY missing — restart the dev server after adding it');
  }
  const params = new URLSearchParams({
    key,
    location: `${center.latitude},${center.longitude}`,
    format: 'JSON',
    perpage: String(perpage),
  });
  const response = await fetch(`${Endpoint}?${params}`, { signal: AbortSignal.timeout(3000) });
  if (!response.ok) {
    throw new Error(`Geograph query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { items?: SyndicatorItem[] };
  return buildPhotos(body.items ?? []);
}

/**
 * Pure: the nearest photo within range whose TITLE names the story —
 * the same two-shared-tokens rule as Commons. A photo that is merely
 * near is the SITE, not the subject, and Edd's rule is that a listing
 * you can't recognise on arrival is dead weight: subject photo or no
 * card. (The station photo on the Greenwich Playhouse card is why.)
 */
export function pickMatchingPhoto(
  item: HistoryItem,
  photos: GeographPhoto[],
  maxMeters = 150
): GeographPhoto | null {
  const storyTokens = matchTokens(item.title);
  let best: GeographPhoto | null = null;
  let bestDistance = maxMeters;
  for (const photo of photos) {
    const photoTokens = matchTokens(photo.title);
    const shared = [...storyTokens].filter((token) => photoTokens.has(token)).length;
    if (shared < 2) {
      continue;
    }
    const distance = distanceMeters(item.coordinates, {
      latitude: photo.latitude,
      longitude: photo.longitude,
    });
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = photo;
    }
  }
  return best;
}

/**
 * Dress each unillustrated story with a photo of/near THAT story:
 * Wikimedia Commons first (title-matched — often a photo OF the thing,
 * plaques included), Geograph's everywhere-grid as the fallback. One
 * set of lookups per story, not per user position. Cached per story
 * for a week; the cap bounds a cold area's first request, and the
 * misses warm up on the next one.
 */
const PhotoTtlMs = 7 * 24 * 60 * 60 * 1000;
// Renamed from story-photos: the old cache holds blind nearest-photo
// verdicts (a station on a theatre's card) that must not survive
const photoCache = diskBackedMap<{ photo: StoryPhoto | null; at: number }>('subject-photos');
// A subject photo is now existential for a card, so converge faster
const MaxLookupsPerRequest = 20;

export async function dressWithPhotos(
  items: HistoryItem[],
  fetchPhotos: typeof fetchAreaPhotos = fetchAreaPhotos,
  fetchCommons: typeof findCommonsPhoto = findCommonsPhoto,
  deadlineMs = 1500,
  maxLookups = MaxLookupsPerRequest
): Promise<HistoryItem[]> {
  let lookups = 0;
  // Photos are decoration, not structure: the response never waits past
  // the deadline. Lookups that lose the race keep running and write the
  // cache anyway — the story appears dressed on the next request.
  const deadline = new Promise<undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), deadlineMs);
    (timer as { unref?: () => void }).unref?.();
  });
  return Promise.all(
    items.map(async (item) => {
      if (item.thumbnailUrl) {
        return item;
      }
      const key = String(item.pageId);
      let cached = photoCache.get(key);
      if (!cached || Date.now() - cached.at > PhotoTtlMs) {
        if (lookups >= maxLookups) {
          return item; // stays bare this request; warms up next time
        }
        lookups += 1;
        const lookup = (async () => {
          try {
            const commons = await fetchCommons(item.title, item.coordinates).catch(() => null);
            const photo =
              commons ?? pickMatchingPhoto(item, await fetchPhotos(item.coordinates)) ?? null;
            const entry = { photo, at: Date.now() };
            photoCache.set(key, entry);
            return entry;
          } catch {
            // Failures AND missing-key runs are not cached — a verdict of
            // "no photo exists" may only come from a source that answered
            return undefined;
          }
        })();
        cached = await Promise.race([lookup, deadline]);
        if (!cached) {
          return item; // deadline or failure — the lookup finishes in the background
        }
      }
      if (!cached.photo) {
        return item;
      }
      return { ...item, thumbnailUrl: cached.photo.imageUrl, thumbnailCredit: cached.photo.credit };
    })
  );
}
