import { WalkingRoute, WalkingRouteStep } from '@/types/route';
import { Coordinates, distanceMeters } from '@/utils/geo';

/** Within this range of a maneuver point, the step counts as completed. */
const ArrivalThresholdMeters = 20;

export type Guidance = {
  step: WalkingRouteStep;
  stepIndex: number;
  /** Where the needle points: the current step's maneuver point. */
  target: Coordinates;
  /** Meters from the user to that maneuver point. */
  metersToManeuver: number;
  arrived: boolean;
};

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
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (-A.x * abX + -A.y * abY) / lengthSquared));
  return Math.hypot(A.x + t * abX, A.y + t * abY);
}

/**
 * Satnav logic: find the route segment the user is actually on (nearest
 * segment), point the needle at that step's maneuver point, and advance
 * to the next step once within arrival range of the corner. Reports
 * arrived when that happens on the final step.
 */
export function guidanceFor(route: WalkingRoute, user: Coordinates): Guidance | null {
  const steps = route.steps.filter((step) => step.end);
  if (steps.length === 0) {
    return null;
  }

  // Which segment is the user on?
  let currentIndex = 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < steps.length; index++) {
    const { start, end } = steps[index];
    const meters = start
      ? distanceToSegmentMeters(user, start, end!)
      : distanceMeters(user, end!);
    if (meters < nearest) {
      nearest = meters;
      currentIndex = index;
    }
  }

  // Reached this segment's corner? Guide to the next one.
  let arrived = false;
  if (distanceMeters(user, steps[currentIndex].end!) <= ArrivalThresholdMeters) {
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
    target: step.end!,
    metersToManeuver: distanceMeters(user, step.end!),
    arrived,
  };
}
