import { Coordinates } from '@/utils/geo';

/**
 * The walking route's shape, defined once for both sides of the wire:
 * src/server/route.ts builds it from Valhalla's trip, src/data/
 * route-client.ts consumes it. One truth per shape.
 */

export type RouteManeuver = { instruction: string; meters: number; beginIndex: number };

/** The route cache's ~27m origin grid, shared by the server cache and
 * the client session cache: a new route when you've actually walked,
 * not when GPS breathes. */
export function routeOriginBucket(position: Coordinates): string {
  return `${Math.round(position.latitude * 4000) / 4000}|${Math.round(position.longitude * 4000) / 4000}`;
}

export type WalkingRoute = {
  coordinates: Coordinates[];
  maneuvers: RouteManeuver[];
  meters: number;
  seconds: number;
};
