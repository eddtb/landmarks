import { Coordinates } from '@/utils/geo';

/**
 * Sunset time via the NOAA simplified solar equations — accurate to a
 * few minutes, which is all "catch the golden hour" needs. No API,
 * no key: the sky's schedule is just math.
 */
export function sunsetAt(coordinates: Coordinates, date: Date): Date | null {
  const rad = Math.PI / 180;
  const dayOfYear =
    Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) -
        Date.UTC(date.getFullYear(), 0, 0)) /
        86400000
    );

  const latitude = coordinates.latitude;
  const longitude = coordinates.longitude;

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + 0.5);
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  // Zenith 90.833° accounts for refraction and the sun's radius
  const cosHourAngle =
    (Math.cos(90.833 * rad) - Math.sin(latitude * rad) * Math.sin(declination)) /
    (Math.cos(latitude * rad) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) {
    // Polar day or night — no sunset today
    return null;
  }
  const hourAngle = Math.acos(cosHourAngle) / rad;

  // longitude MINUS the hour angle is sunset; plus would be sunrise
  const sunsetMinutesUtc = 720 - 4 * (longitude - hourAngle) - eqTime;
  const sunset = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) + sunsetMinutesUtc * 60000
  );
  return sunset;
}
