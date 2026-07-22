import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { Coordinates } from '@/utils/geo';

/**
 * "Deptford", from free on-device reverse geocoding — the browse
 * header's area name. Null (caller falls back to "Nearby") until
 * resolved, or when the device can't say.
 */
export function useAreaName(center: Coordinates): string | null {
  const [name, setName] = useState<string | null>(null);
  // ~111m buckets: an area NAME can't change inside one, and effect
  // deps finer than that re-geocoded on every ~10m GPS tick.
  const latitude = Number(center.latitude.toFixed(3));
  const longitude = Number(center.longitude.toFixed(3));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [first] = await Location.reverseGeocodeAsync({ latitude, longitude });
        const resolved = first?.district ?? first?.subregion ?? first?.city ?? null;
        if (!cancelled) {
          // Crossing a bucket rarely crosses a district — same name
          // stays the same state, no header re-render
          setName((prev) => (prev === resolved ? prev : resolved));
        }
      } catch {
        // keep the fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  return name;
}
