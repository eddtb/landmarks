import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';

/** Sensor jitter below this never reaches React — the dial's own
 * 300ms easing absorbs real turns; sub-2° noise just burned renders. */
const DeadBandDegrees = 2;

/**
 * Compass heading in degrees (0 = north), or null where unavailable
 * (permission missing, no magnetometer — e.g. the simulator). Consumers
 * hide direction arrows when null.
 */
export function useHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);
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
            setHeading(null);
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
          setHeading(degrees);
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
  }, [enabled]);

  return heading;
}
