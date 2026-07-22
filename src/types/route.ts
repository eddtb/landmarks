import { Coordinates } from '@/utils/geo';

/**
 * The walking route's shape, defined once for both sides of the wire:
 * src/server/route.ts builds it from Valhalla's trip, src/data/
 * route-client.ts consumes it. One truth per shape.
 */

export type RouteManeuver = { instruction: string; meters: number; beginIndex: number };

export type WalkingRoute = {
  coordinates: Coordinates[];
  maneuvers: RouteManeuver[];
  meters: number;
  seconds: number;
};
