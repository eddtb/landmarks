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

export async function fetchAreaPhotos(center: Coordinates): Promise<GeographPhoto[]> {
  const key = process.env.GEOGRAPH_API_KEY;
  if (!key) {
    return [];
  }
  const params = new URLSearchParams({
    key,
    location: `${center.latitude},${center.longitude}`,
    format: 'JSON',
    perpage: '50',
  });
  const response = await fetch(`${Endpoint}?${params}`);
  if (!response.ok) {
    throw new Error(`Geograph query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { items?: SyndicatorItem[] };
  return buildPhotos(body.items ?? []);
}

/**
 * Give each unillustrated story the nearest unused photo within range.
 * Pure: returns new items, never mutates.
 */
export function assignPhotos(
  items: HistoryItem[],
  photos: GeographPhoto[],
  maxMeters = 150
): HistoryItem[] {
  const unused = [...photos];
  return items.map((item) => {
    if (item.thumbnailUrl) {
      return item;
    }
    let bestIndex = -1;
    let bestDistance = maxMeters;
    for (let index = 0; index < unused.length; index++) {
      const photo = unused[index];
      const distance = distanceMeters(item.coordinates, {
        latitude: photo.latitude,
        longitude: photo.longitude,
      });
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex === -1) {
      return item;
    }
    const [photo] = unused.splice(bestIndex, 1);
    return { ...item, thumbnailUrl: photo.imageUrl, thumbnailCredit: photo.credit };
  });
}
