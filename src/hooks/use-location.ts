import * as Location from 'expo-location';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { Coordinates } from '@/utils/geo';

export type LocationStatus =
  /** Permission state not yet known (first render). */
  | 'loading'
  /** Never asked — the root one-door gate owns this state. */
  | 'priming'
  /** Permission granted, waiting for a position fix. */
  | 'locating'
  /** Permission denied — callers should fall back and offer Settings. */
  | 'denied'
  /** Position available. */
  | 'ready';

/**
 * ONE permission truth for the whole app (the use-pin primitive: a
 * value, a listener set, useSyncExternalStore). Expo's
 * useForegroundPermissions keeps PER-INSTANCE state — each hook
 * fetches once on mount and only updates on its own request — so the
 * root one-door gate granting location would never reach the tabs'
 * own instances and they'd prime forever. A module store means
 * whoever requests, every subscriber learns.
 */
let permission: Location.PermissionResponse | null = null;
let fetchStarted = false;
const listeners = new Set<() => void>();

function setPermission(next: Location.PermissionResponse | null) {
  permission = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return permission;
}

function ensurePermissionFetched() {
  if (fetchStarted) {
    return;
  }
  fetchStarted = true;
  Location.getForegroundPermissionsAsync()
    .then(setPermission)
    // Status stays 'loading'; the next mount may try again
    .catch(() => {
      fetchStarted = false;
    });
}

/**
 * THE one request path — the one-door gate's Enable and nobody else,
 * so a launch can never show two system prompts. The dialog's answer
 * lands in the shared store and every mounted hook moves on together.
 */
export async function requestLocationPermission(): Promise<void> {
  setPermission(await Location.requestForegroundPermissionsAsync());
}

/** The shared permission state; null while the first read is in flight. */
export function useLocationPermission(): Location.PermissionResponse | null {
  useEffect(ensurePermissionFetched, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Tests only: the store is module-level and must not leak between them. */
export function resetLocationPermissionForTests() {
  permission = null;
  fetchStarted = false;
}

export function useLocation(): {
  status: LocationStatus;
  coordinates: Coordinates | null;
} {
  const currentPermission = useLocationPermission();
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);

  const granted = currentPermission?.granted ?? false;

  useEffect(() => {
    if (!granted) {
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;

    (async () => {
      // Last known fix is instant when available; the watch takes over from there.
      const lastKnown = await Location.getLastKnownPositionAsync();
      if (!cancelled && lastKnown) {
        setCoordinates(lastKnown.coords);
      }
      // Live position: emits an initial fix, then again every ~10m walked,
      // so distances tick down and the list re-sorts as you move.
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10 },
        (update) => {
          if (!cancelled) {
            setCoordinates(update.coords);
          }
        }
      );
      if (cancelled) {
        subscription.remove();
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [granted]);

  let status: LocationStatus;
  if (!currentPermission) {
    status = 'loading';
  } else if (granted) {
    status = coordinates ? 'ready' : 'locating';
  } else if (currentPermission.status === 'undetermined') {
    status = 'priming';
  } else {
    status = 'denied';
  }

  return { status, coordinates };
}
