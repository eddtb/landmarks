import { useCallback, useEffect } from 'react';
import { Alert, Linking } from 'react-native';

import { disableArrivals, enableArrivals, syncArrivalRegions } from '@/data/arrival-geofence';
import { useArrivalsEnabled } from '@/data/arrivals';
import { useSavedList } from '@/data/saved';
import { HistoryItem } from '@/types/history';

/**
 * The feed's standing duty while arrivals are on: keep the twenty
 * monitored regions in step with the ground under the user. Runs on
 * every change of feed — walking mints a new one every hundred metres
 * or so — and on the flip of the toggle, which is what arms the very
 * first set.
 *
 * `syncArrivalRegions` is a no-op when the chosen twenty haven't
 * changed, so the churn of a walk costs nothing.
 */
export function useArrivalsSync(items: HistoryItem[], enabled: boolean) {
  const saved = useSavedList();

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void syncArrivalRegions(
      items,
      (saved ?? []).map((place) => place.item)
    );
  }, [items, saved, enabled]);
}

/**
 * The toggle behind both doors — the feed invitation and the ⋯ menu.
 * A refusal is an answer, not an error: it says what is missing and
 * offers the one place it can be changed.
 */
export function useArrivalsToggle(): { enabled: boolean; toggle: () => Promise<void> } {
  const enabled = useArrivalsEnabled();

  const toggle = useCallback(async () => {
    if (enabled) {
      await disableArrivals();
      return;
    }
    const outcome = await enableArrivals();
    if (outcome === 'granted') {
      return;
    }
    const missing =
      outcome === 'denied-notifications'
        ? 'Arrivals need permission to send notifications.'
        : 'Arrivals need location access set to Always, so the app can be woken when you reach somewhere.';
    Alert.alert('Arrivals are off', missing, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Open Settings', onPress: () => Linking.openSettings() },
    ]);
  }, [enabled]);

  return { enabled, toggle };
}
