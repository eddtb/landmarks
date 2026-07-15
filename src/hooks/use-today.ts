import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchTodayNearby } from '@/data/today-client';
import { TodayEvent } from '@/types/today';
import { Coordinates } from '@/utils/geo';

export type TodayState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; events: TodayEvent[] };

/**
 * Reverse-geocodes on device (free) so the research prompt can say
 * "Deptford, London" instead of raw coordinates. The area name is a
 * nice-to-have — lookups proceed without it.
 */
async function areaName(center: Coordinates): Promise<string | undefined> {
  try {
    const [first] = await Location.reverseGeocodeAsync(center);
    return first?.district ?? first?.subregion ?? first?.city ?? undefined;
  } catch {
    return undefined;
  }
}

export function useToday(center: Coordinates): {
  state: TodayState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<TodayState>({ status: 'loading' });
  const { latitude, longitude } = center;
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    (async () => {
      try {
        const area = await areaName({ latitude, longitude });
        const events = await fetchTodayNearby({ latitude, longitude }, area);
        if (id === requestId.current) {
          setState({ status: 'ready', events });
        }
      } catch (error) {
        console.warn("Failed to load today's events:", error);
        if (id === requestId.current) {
          setState({ status: 'error' });
        }
      }
    })();
  }, [latitude, longitude]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const area = await areaName({ latitude, longitude });
      const events = await fetchTodayNearby({ latitude, longitude }, area, {
        forceRefresh: true,
      });
      if (id === requestId.current) {
        setState({ status: 'ready', events });
      }
    } catch (error) {
      console.warn("Failed to refresh today's events:", error);
      if (id === requestId.current) {
        setState({ status: 'error' });
      }
    }
  }, [latitude, longitude]);

  return { state, refresh };
}
