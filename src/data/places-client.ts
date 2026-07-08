import Constants from 'expo-constants';
import { fetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { Place, PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates } from '@/utils/geo';

/**
 * The app's only data source: our own API routes.
 *
 * On native the request needs an absolute URL: in development that's the
 * Metro dev server (hostUri); in production builds it's the deployed origin
 * configured on the expo-router plugin. Web can stay relative.
 */
function apiUrl(path: string): string {
  if (Platform.OS === 'web') {
    return path;
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    return `http://${hostUri}${path}`;
  }
  const origin = Constants.expoConfig?.extra?.router?.origin;
  if (typeof origin === 'string') {
    return `${origin.replace(/\/$/, '')}${path}`;
  }
  throw new Error('No API origin configured for this build');
}

// Places already fetched this session, so the detail screen can render
// without a second network round-trip.
const placeCache = new Map<string, Place>();

export async function fetchNearbyPlaces(
  category: PlaceCategory,
  center: Coordinates
): Promise<PlaceWithDistance[]> {
  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
    category,
  });

  const response = await fetch(apiUrl(`/api/places?${params}`));
  if (!response.ok) {
    throw new Error(`Places request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { places: PlaceWithDistance[] };
  for (const place of body.places) {
    placeCache.set(place.id, place);
  }
  return body.places;
}

export function getCachedPlace(id: string): Place | undefined {
  return placeCache.get(id);
}

/** Test seam: lets tests seed the cache without network. */
export function cachePlaces(places: Place[]) {
  for (const place of places) {
    placeCache.set(place.id, place);
  }
}
