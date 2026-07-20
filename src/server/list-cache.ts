import { diskBackedMap } from '@/server/ai-cache';
import { PlaceWithDistance } from '@/types/place';
import { Coordinates } from '@/utils/geo';

/**
 * The ONE list cache, shared by the browse route and the plan
 * engine — they were keeping separate copies, so the suggestion rail
 * re-bought area data browsing had already paid for.
 *
 * Location-first rule (Edd's, standing): every key includes the
 * ~100m area bucket. TTLs govern re-asking about the SAME spot;
 * movement always produces a new key and fresh results.
 */

type Entry = { places: PlaceWithDistance[]; expires: number };

const cache = diskBackedMap<Entry>('places-lists');

export const ListTtlMs = 60 * 60 * 1000;

export function listCacheKey(center: Coordinates, category: string): string {
  return `${center.latitude.toFixed(3)},${center.longitude.toFixed(3)}|${category}`;
}

export function getCachedList(center: Coordinates, category: string): PlaceWithDistance[] | null {
  const entry = cache.get(listCacheKey(center, category));
  return entry && entry.expires > Date.now() ? entry.places : null;
}

export function setCachedList(center: Coordinates, category: string, places: PlaceWithDistance[]) {
  cache.set(listCacheKey(center, category), { places, expires: Date.now() + ListTtlMs });
}
