/**
 * Google photo resource names carry a reference token that rotates
 * between API responses — the list and the details name the SAME photo
 * differently, so URLs built from them defeat every cache and the
 * venue hero visibly refetches. The app-facing URL is therefore keyed
 * by place + index (stable by construction) and this module maps it
 * back to whatever token Google currently answers to.
 *
 * The dev server re-evaluates route modules per request, resetting
 * module state — so the cache lives on globalThis, which survives
 * within the server process.
 */

import { chargeGoogle } from '@/server/google-budget';

const PlaceDetailsEndpoint = 'https://places.googleapis.com/v1/places';

type CacheEntry = { names: string[]; expires: number };

const globalCache = globalThis as { photoNamesCache?: Map<string, CacheEntry> };

function cache(): Map<string, CacheEntry> {
  globalCache.photoNamesCache ??= new Map();
  return globalCache.photoNamesCache;
}

/** Tokens outlive this comfortably; expiry is belt — retry-on-failure is braces. */
const NamesTtlMs = 12 * 60 * 60 * 1000;

/** Every search/details response refreshes what we know for free. */
export function rememberPhotoNames(placeId: string, names: string[]) {
  if (names.length > 0) {
    cache().set(placeId, { names, expires: Date.now() + NamesTtlMs });
  }
}

export function getRememberedPhotoName(placeId: string, index: number): string | undefined {
  const entry = cache().get(placeId);
  if (!entry || entry.expires < Date.now()) {
    return undefined;
  }
  return entry.names[index];
}

/** Cache miss (server restart, expiry): one lean details call re-learns the tokens. */
export async function fetchPhotoNames(placeId: string, apiKey: string): Promise<string[]> {
  chargeGoogle('photoNames');
  const response = await fetch(`${PlaceDetailsEndpoint}/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'photos.name' },
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as { photos?: { name: string }[] };
  const names = (body.photos ?? []).map((photo) => photo.name);
  rememberPhotoNames(placeId, names);
  return names;
}
