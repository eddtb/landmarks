import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { NativeModules, Platform } from 'react-native';

import { Place, PlaceCategory, PlaceDetails, PlaceWithDistance } from '@/types/place';
import { Coordinates } from '@/utils/geo';

/**
 * The app's only data source: our own API routes.
 *
 * On native the request needs an absolute URL. In development that's the
 * Metro dev server, but where to find it depends on how the app runs:
 * Expo Go exposes it as hostUri, while native dev builds (expo run:ios)
 * only reveal it through the JS bundle's own URL. Production builds use
 * the deployed origin configured on the expo-router plugin. Web stays
 * relative.
 */
export function apiUrl(path: string): string {
  if (Platform.OS === 'web') {
    return path;
  }

  // Expo Go
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    return `http://${hostUri}${path}`;
  }

  // Native dev build: ask React Native where the dev server is
  if (__DEV__) {
    try {
      // Internal RN module — no public equivalent for dev builds yet
      const getDevServer =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('react-native/Libraries/Core/Devtools/getDevServer').default;
      const devServerUrl: string | undefined = getDevServer?.()?.url;
      if (devServerUrl?.startsWith('http')) {
        return `${new URL(devServerUrl).origin}${path}`;
      }
    } catch {
      // fall through to the other sources
    }
  }

  // Native dev build (older architecture): the bundle URL knows the origin
  const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
  if (scriptURL?.startsWith('http')) {
    return `${new URL(scriptURL).origin}${path}`;
  }

  // Production build with a deployed server
  const origin = Constants.expoConfig?.extra?.router?.origin;
  if (typeof origin === 'string') {
    return `${origin.replace(/\/$/, '')}${path}`;
  }

  throw new Error('No API origin configured for this build');
}

// Places already fetched this session, so the detail screen can render
// without a second network round-trip.
const placeCache = new Map<string, Place>();

// Each section's list, cached per category + position for the session.
// Switching between sections costs no network; pull-to-refresh bypasses.
const listCache = new Map<string, PlaceWithDistance[]>();

function listCacheKey(category: PlaceCategory, center: Coordinates): string {
  // ~11m grid: position jitter should not needlessly bust the cache
  return `${category}|${center.latitude.toFixed(4)}|${center.longitude.toFixed(4)}`;
}

export async function fetchNearbyPlaces(
  category: PlaceCategory,
  center: Coordinates,
  options?: { forceRefresh?: boolean }
): Promise<PlaceWithDistance[]> {
  const cacheKey = listCacheKey(category, center);
  if (!options?.forceRefresh) {
    const cached = listCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
    category,
    ...(options?.forceRefresh ? { fresh: '1' } : {}),
  });

  const response = await fetch(apiUrl(`/api/places?${params}`));
  if (!response.ok) {
    throw new Error(`Places request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { places: PlaceWithDistance[] };
  listCache.set(cacheKey, body.places);
  for (const place of body.places) {
    placeCache.set(place.id, place);
  }
  return body.places;
}

export function getCachedPlace(id: string): Place | undefined {
  return placeCache.get(id);
}

// Rich details, cached per place per session (two-tier fetching).
const detailsCache = new Map<string, PlaceDetails>();

export async function fetchPlaceDetails(id: string): Promise<PlaceDetails | null> {
  const cached = detailsCache.get(id);
  if (cached) {
    return cached;
  }

  const response = await fetch(apiUrl(`/api/place/${encodeURIComponent(id)}`));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Place details request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { place: PlaceDetails };
  detailsCache.set(id, body.place);
  return body.place;
}

/** Test seam: lets tests seed the cache without network. */
export function cachePlaces(places: Place[]) {
  for (const place of places) {
    placeCache.set(place.id, place);
  }
}
