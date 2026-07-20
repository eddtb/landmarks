import { diskBackedMap } from '@/server/ai-cache';
import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Geograph photographs essentially every hundred-metre square of
 * Britain, CC BY-SA. One area query per history request; the photos
 * dress the stories that Wikipedia left unillustrated. Requires the
 * free GEOGRAPH_API_KEY; without it, stories simply keep no photo.
 */

const Endpoint = 'https://api.geograph.org.uk/syndicator.php';

export type GeographPhoto = {
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
    return [];
  }
  const params = new URLSearchParams({
    key,
    location: `${center.latitude},${center.longitude}`,
    format: 'JSON',
    perpage: String(perpage),
  });
  const response = await fetch(`${Endpoint}?${params}`);
  if (!response.ok) {
    throw new Error(`Geograph query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { items?: SyndicatorItem[] };
  return buildPhotos(body.items ?? []);
}

/** Pure: the nearest photo within range, or null. */
export function pickPhotoFor(
  item: HistoryItem,
  photos: GeographPhoto[],
  maxMeters = 150
): GeographPhoto | null {
  let best: GeographPhoto | null = null;
  let bestDistance = maxMeters;
  for (const photo of photos) {
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
 * Dress each unillustrated story with a photo taken near THAT story —
 * one syndicator query per story, not one per user position: photos
 * near the user cluster within a couple hundred metres and leave every
 * further story bare (measured: 1 of 40 dressed). Cached per story for
 * a week; the cap bounds a cold area's first request, and the misses
 * warm up on the next one.
 */
const PhotoTtlMs = 7 * 24 * 60 * 60 * 1000;
const photoCache = diskBackedMap<{ photo: GeographPhoto | null; at: number }>('geograph-photos');
const MaxLookupsPerRequest = 15;

export async function dressWithPhotos(
  items: HistoryItem[],
  fetchPhotos: typeof fetchAreaPhotos = fetchAreaPhotos
): Promise<HistoryItem[]> {
  let lookups = 0;
  return Promise.all(
    items.map(async (item) => {
      if (item.thumbnailUrl) {
        return item;
      }
      const key = String(item.pageId);
      let cached = photoCache.get(key);
      if (!cached || Date.now() - cached.at > PhotoTtlMs) {
        if (lookups >= MaxLookupsPerRequest) {
          return item; // stays bare this request; warms up next time
        }
        lookups += 1;
        try {
          const photos = await fetchPhotos(item.coordinates);
          cached = { photo: pickPhotoFor(item, photos), at: Date.now() };
          photoCache.set(key, cached);
        } catch {
          return item; // failures aren't cached — next request retries
        }
      }
      if (!cached.photo) {
        return item;
      }
      return { ...item, thumbnailUrl: cached.photo.imageUrl, thumbnailCredit: cached.photo.credit };
    })
  );
}
