export type Coordinates = {
  latitude: number;
  longitude: number;
};

const EARTH_RADIUS_METERS = 6_371_000;

/** Great-circle distance between two points (haversine formula). */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

  const latDelta = toRadians(to.latitude - from.latitude);
  const lonDelta = toRadians(to.longitude - from.longitude);
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);

  const a =
    Math.sin(latDelta / 2) ** 2 + Math.cos(fromLat) * Math.cos(toLat) * Math.sin(lonDelta / 2) ** 2;

  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Central London — fallback position when location is unavailable. */
export const FallbackCoordinates: Coordinates = {
  latitude: 51.5074,
  longitude: -0.1278,
};

/** Initial bearing from `from` to `to`, degrees clockwise from north (0–360). */
export function bearingDegrees(from: Coordinates, to: Coordinates): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const fromLat = toRadians(from.latitude);
  const toLat = toRadians(to.latitude);
  const lonDelta = toRadians(to.longitude - from.longitude);

  const y = Math.sin(lonDelta) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) -
    Math.sin(fromLat) * Math.cos(toLat) * Math.cos(lonDelta);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const CompassArrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'] as const;

/**
 * Which arrow points at the target, given the direction the user is facing.
 * "Relative bearing 0" = straight ahead = ↑.
 */
export function arrowTowards(
  from: Coordinates,
  to: Coordinates,
  headingDegrees: number
): string {
  const relative = (bearingDegrees(from, to) - headingDegrees + 360) % 360;
  return CompassArrows[Math.round(relative / 45) % 8];
}
