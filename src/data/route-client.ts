import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { Coordinates } from '@/utils/geo';

export type RouteManeuver = { instruction: string; meters: number; beginIndex: number };
export type WalkingRoute = {
  coordinates: Coordinates[];
  maneuvers: RouteManeuver[];
  meters: number;
  seconds: number;
};

// Session cache on the same ~27m origin grid the server uses
const cache = new Map<string, WalkingRoute>();

function key(from: Coordinates, to: Coordinates): string {
  return (
    `${Math.round(from.latitude * 4000) / 4000}|${Math.round(from.longitude * 4000) / 4000}` +
    `→${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`
  );
}

export async function fetchRoute(from: Coordinates, to: Coordinates): Promise<WalkingRoute> {
  const cacheKey = key(from, to);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const params = new URLSearchParams({
    fromLat: String(from.latitude),
    fromLng: String(from.longitude),
    toLat: String(to.latitude),
    toLng: String(to.longitude),
  });
  const response = await fetch(apiUrl(`/api/route?${params}`));
  if (!response.ok) {
    throw new Error(`Route request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { route: WalkingRoute };
  cache.set(cacheKey, body.route);
  return body.route;
}
