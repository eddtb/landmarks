import * as Location from 'expo-location';
import { useEffect, useState } from 'react';

/**
 * Compass heading in degrees (0 = north), or null where unavailable
 * (permission missing, no magnetometer — e.g. the simulator). Consumers
 * hide direction arrows when null.
 */
export function useHeading(enabled: boolean): number | null {
  const [heading, setHeading] = useState<number | null>(null);

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
          setHeading(degrees >= 0 ? degrees : null);
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
