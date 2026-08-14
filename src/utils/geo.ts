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

const CompassPoints = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** The bearing as a spoken compass point — "away · NE" on the dial. */
export function compassPoint(bearing: number): (typeof CompassPoints)[number] {
  return CompassPoints[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

const CompassWords = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
] as const;

/**
 * The same bearing in words, for prose rather than a dial. "NE" is right
 * on a compass card and wrong in a sentence — and VoiceOver reads it as
 * the letter N, which tells a listener nothing.
 */
export function compassWords(bearing: number): (typeof CompassWords)[number] {
  return CompassWords[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}
