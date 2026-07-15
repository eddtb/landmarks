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
  const { latitude, longitude } = center;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [first] = await Location.reverseGeocodeAsync({ latitude, longitude });
        const resolved = first?.district ?? first?.subregion ?? first?.city ?? null;
        if (!cancelled) {
          setName(resolved);
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
