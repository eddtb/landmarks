import { diskBackedMap } from '@/server/ai-cache';
import { makeBudget } from '@/server/spend-budget';
import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';

/**
 * Walking routes from Valhalla on the FOSSGIS community server —
 * keyless, free, OSM-powered. The old Google Go mode billed ~3p per
 * open for this; the community one costs goodwill, so the breaker
 * counts CALLS and the cache is origin-bucketed (~27m: walking busts
 * it, GPS jitter doesn't). Straight-line is the degrade path — a
 * missing route may slow the walk down, never the screen.
 */

const Endpoint = 'https://valhalla1.openstreetmap.de/route';

const budget = makeBudget({
  provider: 'Valhalla (free walking routes)',
  ledgerName: 'route-call-ledger',
  envVar: 'ROUTE_DAILY_CALLS',
  // Counts calls, not dollars — trip well before being a bad guest
  defaultDailyUsd: 300,
});

/**
 * Pure and unit-tested: Valhalla ships its shape as a precision-6
 * encoded polyline (Google's format, but 1e6 instead of 1e5).
 */
export function decodePolyline6(encoded: string): Coordinates[] {
  const coordinates: Coordinates[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lng'] as const) {
      let result = 0;
      let shift = 0;
      let byte = 0x20;
      while (byte >= 0x20) {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      }
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') {
        latitude += delta;
      } else {
        longitude += delta;
      }
    }
    coordinates.push({ latitude: latitude / 1e6, longitude: longitude / 1e6 });
  }
  return coordinates;
}

type ValhallaTrip = {
  summary?: { length?: number; time?: number };
  legs?: {
    shape?: string;
    maneuvers?: { instruction?: string; length?: number; begin_shape_index?: number }[];
  }[];
};

/** Pure and unit-tested against a recorded live response. */
export function buildRoute(trip: ValhallaTrip): WalkingRoute | null {
  const leg = trip.legs?.[0];
  if (!leg?.shape) {
    return null;
  }
  return {
    coordinates: decodePolyline6(leg.shape),
    maneuvers: (leg.maneuvers ?? []).flatMap((maneuver) =>
      maneuver.instruction
        ? [
            {
              instruction: maneuver.instruction,
              meters: Math.round((maneuver.length ?? 0) * 1000),
              beginIndex: maneuver.begin_shape_index ?? 0,
            },
          ]
        : []
    ),
    meters: Math.round((trip.summary?.length ?? 0) * 1000),
    seconds: Math.round(trip.summary?.time ?? 0),
  };
}

/** ~27m grid: a new route when you've actually walked, not when GPS breathes. */
function originBucket(position: Coordinates): string {
  return `${Math.round(position.latitude * 4000) / 4000}|${Math.round(position.longitude * 4000) / 4000}`;
}

const RouteTtlMs = 24 * 60 * 60 * 1000;
const cache = diskBackedMap<{ route: WalkingRoute; at: number }>('routes');

export async function fetchWalkingRoute(
  from: Coordinates,
  to: Coordinates
): Promise<WalkingRoute | null> {
  const key = `${originBucket(from)}→${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < RouteTtlMs) {
    return cached.route;
  }

  budget.assert();
  const response = await fetch(Endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
    body: JSON.stringify({
      locations: [
        { lat: from.latitude, lon: from.longitude },
        { lat: to.latitude, lon: to.longitude },
      ],
      costing: 'pedestrian',
      units: 'kilometers',
    }),
  });
  if (!response.ok) {
    throw new Error(`Valhalla route failed with status ${response.status}`);
  }
  budget.record(1);

  const body = (await response.json()) as { trip?: ValhallaTrip };
  const route = body.trip ? buildRoute(body.trip) : null;
  if (route) {
    cache.set(key, { route, at: Date.now() });
  }
  return route;
}
