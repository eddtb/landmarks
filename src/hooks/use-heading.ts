import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { SharedValue, useSharedValue } from 'react-native-reanimated';

/** Sensor jitter below this never reaches the dial — its own 300ms
 * easing absorbs real turns; sub-2° noise just burned animations. */
const DeadBandDegrees = 2;

/**
 * Compass heading for the UI thread. The sensor ticks tens of times a
 * second while the user physically turns — as React state that was a
 * render per tick through PointerDial (and a JS-thread withTiming
 * restart each time). The degrees now land in a SharedValue the
 * needle worklets read directly; React hears only the AVAILABILITY
 * transitions (magnetometer present or not — e.g. the simulator has
 * none), which is all the render tree branches on.
 */
export function useHeadingValue(enabled: boolean): {
  /** Degrees (0 = north); only meaningful while `available`. */
  heading: SharedValue<number>;
  /** False where no heading exists — consumers hide the needle. */
  available: boolean;
} {
  const heading = useSharedValue(0);
  const [available, setAvailable] = useState(false);
  const lastEmitted = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    let subscription: Location.LocationSubscription | undefined;

    (async () => {
      try {
        subscription = await Location.watchHeadingAsync((update) => {
          if (cancelled) {
            return;
          }
          const degrees = update.trueHeading >= 0 ? update.trueHeading : update.magHeading;
          if (degrees < 0) {
            lastEmitted.current = null;
            setAvailable(false);
            return;
          }
          const last = lastEmitted.current;
          if (last !== null) {
            // Shortest-arc delta so the band doesn't gape at 359°/1°
            let delta = degrees - last;
            if (delta > 180) delta -= 360;
            if (delta < -180) delta += 360;
            if (Math.abs(delta) < DeadBandDegrees) {
              return;
            }
          }
          lastEmitted.current = degrees;
          heading.set(degrees);
          if (last === null) {
            setAvailable(true); // the one render React still pays for
          }
        });
        if (cancelled) {
          subscription.remove();
        }
      } catch (error) {
        console.warn('Heading unavailable:', error);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled, heading]);

  return { heading, available };
}
