import { WalkingRoute } from '@/types/route';
import { Coordinates, distanceMeters } from '@/utils/geo';

/** Within this range of a maneuver point, the step counts as completed. */
const ArrivalThresholdMeters = 20;

export type GuidanceStep = {
  instruction: string;
  meters: number;
  start?: Coordinates;
  end: Coordinates;
};

export type Guidance = {
  step: GuidanceStep;
  stepIndex: number;
  /** Where the needle points: the current step's maneuver point. */
  target: Coordinates;
  /** Meters from the user to that maneuver point. */
  metersToManeuver: number;
  arrived: boolean;
};

/**
 * The Valhalla shape gives every maneuver its place on the line; a
 * step runs from its own begin index to the next maneuver's. (The
 * venue-era guidance had per-step geometry from Google; this adapter
 * is the only thing that changed when the router did.)
 */
export function stepsFrom(route: WalkingRoute): GuidanceStep[] {
  const lastIndex = route.coordinates.length - 1;
  if (lastIndex < 0) {
    return [];
  }
  // Valhalla appends a zero-length "You have arrived" maneuver at the
  // destination; the venue-era logic expects the LAST LEG to end there
  // instead (its own arrival check says "Here"), so fold it away
  const legs = route.maneuvers.filter((maneuver) => maneuver.beginIndex < lastIndex);
  return legs.map((maneuver, index) => ({
    instruction: maneuver.instruction,
    meters: maneuver.meters,
    start: route.coordinates[maneuver.beginIndex],
    end: route.coordinates[legs[index + 1]?.beginIndex ?? lastIndex],
  }));
}

/**
 * Distance in meters from point `p` to the segment a-b, using a local
 * flat-earth projection (fine at street scale).
 */
function distanceToSegmentMeters(p: Coordinates, a: Coordinates, b: Coordinates): number {
  const metersPerDegreeLongitude = 111320 * Math.cos((p.latitude * Math.PI) / 180);
  const metersPerDegreeLatitude = 110574;
  const toXY = (c: Coordinates) => ({
    x: (c.longitude - p.longitude) * metersPerDegreeLongitude,
    y: (c.latitude - p.latitude) * metersPerDegreeLatitude,
  });

  const A = toXY(a);
  const B = toXY(b);
  const abX = B.x - A.x;
  const abY = B.y - A.y;
  const lengthSquared = abX * abX + abY * abY;
  // Projection of the user (origin) onto the segment, clamped to its ends
  const t =
    lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (-A.x * abX + -A.y * abY) / lengthSquared));
  return Math.hypot(A.x + t * abX, A.y + t * abY);
}

/**
 * Corridor half-width for re-routing, in meters. Urban GPS jitter runs
 * ~5-15m and a wrong-side-of-the-street fix adds up to ~20m more, so
 * anything under ~30m flaps on noise alone. 35m also clears the ~27.8m
 * origin bucket that used to drive a refetch every grid cell, while
 * staying well under a short city block (~80m) — so a genuinely wrong
 * turn still triggers a re-route within a few paces.
 */
export const RouteCorridorMeters = 35;

/** The route currently guiding the user, and the destination it serves. */
export type RouteCorridor = { route: WalkingRoute; target: Coordinates };

/** Nearest distance in meters from the user to the route's polyline. */
export function distanceToRouteMeters(route: WalkingRoute, user: Coordinates): number {
  const points = route.coordinates;
  if (points.length === 0) {
    return Number.POSITIVE_INFINITY;
  }
  let nearest = distanceMeters(user, points[0]);
  for (let index = 0; index < points.length - 1; index++) {
    const meters = distanceToSegmentMeters(user, points[index], points[index + 1]);
    if (meters < nearest) {
      nearest = meters;
    }
  }
  return nearest;
}

/**
 * Should this GPS tick re-ask the router? Only when there is no route
 * yet, the destination changed, or the user has left the corridor —
 * every on-route tick is judged locally, with no network involved.
 */
export function needsReroute(
  corridor: RouteCorridor | null,
  user: Coordinates,
  target: Coordinates,
): boolean {
  if (!corridor) {
    return true;
  }
  if (
    corridor.target.latitude !== target.latitude ||
    corridor.target.longitude !== target.longitude
  ) {
    return true;
  }
  return distanceToRouteMeters(corridor.route, user) > RouteCorridorMeters;
}

/**
 * Satnav logic: find the route segment the user is actually on (nearest
 * segment), point the needle at that step's maneuver point, and advance
 * to the next step once within arrival range of the corner. Reports
 * arrived when that happens on the final step.
 */
export function guidanceFor(route: WalkingRoute, user: Coordinates): Guidance | null {
  const steps = stepsFrom(route);
  if (steps.length === 0) {
    return null;
  }

  // Which segment is the user on?
  let currentIndex = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < steps.length; index++) {
    const { start, end } = steps[index];
    const meters = start ? distanceToSegmentMeters(user, start, end) : distanceMeters(user, end);
    if (meters < nearest) {
      nearest = meters;
      currentIndex = index;
    }
  }

  // Reached this segment's corner? Guide to the next one.
  let arrived = false;
  if (distanceMeters(user, steps[currentIndex].end) <= ArrivalThresholdMeters) {
    if (currentIndex === steps.length - 1) {
      arrived = true;
    } else {
      currentIndex += 1;
    }
  }

  const step = steps[currentIndex];
  return {
    step,
    stepIndex: currentIndex,
    target: step.end,
    metersToManeuver: Math.round(distanceMeters(user, step.end)),
    arrived,
  };
}
