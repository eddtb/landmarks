import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

import { Coordinates } from '@/utils/geo';

export type LocationStatus =
  /** Permission state not yet known (first render). */
  | 'loading'
  /** Never asked — show the priming explanation before the system dialog. */
  | 'priming'
  /** Permission granted, waiting for a position fix. */
  | 'locating'
  /** Permission denied — callers should fall back and offer Settings. */
  | 'denied'
  /** Position available. */
  | 'ready';

export function useLocation(): {
  status: LocationStatus;
  coordinates: Coordinates | null;
  requestPermission: () => Promise<void>;
} {
  const [permission, requestPermission] = Location.useForegroundPermissions();
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const granted = permission?.granted ?? false;

  useEffect(() => {
    if (!granted) {
      return;
    }
    let cancelled = false;

    (async () => {
      // Last known fix is instant when available; a fresh fix can take seconds.
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (!cancelled && lastKnown) {
        setCoordinates(lastKnown.coords);
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!cancelled) {
        setCoordinates(current.coords);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [granted]);

  let status: LocationStatus;
  if (!permission) {
    status = 'loading';
  } else if (granted) {
    status = coordinates ? 'ready' : 'locating';
  } else if (permission.status === 'undetermined') {
    status = 'priming';
  } else {
    status = 'denied';
  }

  return {
    status,
    coordinates,
    requestPermission: async () => {
      await requestPermission();
    },
  };
}
