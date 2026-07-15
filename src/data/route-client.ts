import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';

// Routes are cached per (origin-grid, destination) for the session — a
// ~11m origin grid means standing still doesn't refetch, walking does.
const routeCache = new Map<string, WalkingRoute | null>();

function cacheKey(from: Coordinates, to: Coordinates): string {
  return `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}|${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
}

export async function fetchWalkingRoute(
  from: Coordinates,
  to: Coordinates
): Promise<WalkingRoute | null> {
  const key = cacheKey(from, to);
  const cached = routeCache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const params = new URLSearchParams({
    fromLat: String(from.latitude),
    fromLng: String(from.longitude),
    toLat: String(to.latitude),
    toLng: String(to.longitude),
  });

  const response = await fetch(apiUrl(`/api/route?${params}`));
  if (response.status === 404) {
    routeCache.set(key, null);
    return null;
  }
  if (!response.ok) {
    throw new Error(`Route request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { route: WalkingRoute };
  routeCache.set(key, body.route);
  return body.route;
}
