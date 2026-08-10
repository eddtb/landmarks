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
 * THE one request path: every ask in the app funnels through here, so
 * the dialog's answer lands in the shared store and every mounted hook
 * moves on together. Two call sites now, not one — the door's Continue
 * and the in-app ask (src/components/location-ask.tsx) that "Not now"
 * left no way back to (#290). iOS shows the system prompt once and
 * answers from its own record afterwards, so a second caller cannot
 * produce a second dialog.
 */
export async function requestLocationPermission(): Promise<void> {
  setPermission(await Location.requestForegroundPermissionsAsync());
}

/**
 * How long a granted permission may hunt for a fix before the screen
 * stops promising one. A cold start indoors really can take this long,
 * so it is a floor under the wait — not a deadline on it.
 */
export const SlowFixMs = 15000;

/**
 * True once `waiting` has held for {@link SlowFixMs}. `'locating'` has
 * no natural end — a granted permission with no fix spins exactly as
 * forever as a denied one did — so every screen that waits on a
 * position puts this floor under the wait and says what is happening.
 */
export function useSlowFix(waiting: boolean): boolean {
  const [elapsed, setElapsed] = useState(false);
  // Adjust during render (the quiz screen's own pattern): a wait that
  // starts or ends takes the floor with it, without an effect that
  // would cascade a second render to say so.
  const [waitingFor, setWaitingFor] = useState(waiting);
  if (waitingFor !== waiting) {
    setWaitingFor(waiting);
    setElapsed(false);
  }

  useEffect(() => {
    if (!waiting) {
      return;
    }
    const timer = setTimeout(() => setElapsed(true), SlowFixMs);
    return () => clearTimeout(timer);
  }, [waiting]);

  return elapsed;
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
      // Caught like use-heading's sibling watch: services flipped off
      // after the grant must not become an unhandled rejection that
      // strands the hook — the screens' no-fix states take over.
      try {
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
      } catch (error) {
        console.warn('Location unavailable:', error);
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
