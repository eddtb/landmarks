import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Pure navigation arithmetic for the Go screen: where you are along
 * the route, how far you've strayed from it, and what to do next.
 */

export function nearestPointIndex(points: Coordinates[], position: Coordinates): number {
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < points.length; index++) {
    const distance = distanceMeters(points[index], position);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

export function metersFromRoute(points: Coordinates[], position: Coordinates): number {
  if (points.length === 0) {
    return Infinity;
  }
  return distanceMeters(points[nearestPointIndex(points, position)], position);
}

type Maneuver = { instruction: string; meters: number; beginIndex: number };

/**
 * The next thing to do: the first maneuver that begins at or after
 * where you are, with the walking distance until it. Standing past
 * the last turn, you get the final instruction (the arrival).
 */
export function upcomingManeuver(
  points: Coordinates[],
  maneuvers: Maneuver[],
  position: Coordinates
): { instruction: string; metersUntil: number } | null {
  if (maneuvers.length === 0 || points.length === 0) {
    return null;
  }
  const here = nearestPointIndex(points, position);
  const next = maneuvers.find((maneuver) => maneuver.beginIndex > here);
  if (!next) {
    const last = maneuvers[maneuvers.length - 1];
    return { instruction: last.instruction, metersUntil: 0 };
  }
  let metersUntil = 0;
  for (let index = here; index < next.beginIndex && index + 1 < points.length; index++) {
    metersUntil += distanceMeters(points[index], points[index + 1]);
  }
  return { instruction: next.instruction, metersUntil: Math.round(metersUntil) };
}
