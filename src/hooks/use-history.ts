import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyHistory, HistoryFetchResult } from '@/data/history-client';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: HistoryItem[]; stale?: boolean };

export function useHistory(center: Coordinates): {
  state: HistoryState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const { latitude, longitude } = center;
  const requestId = useRef(0);

  // An expired persisted bucket paints instantly as a placeholder; the
  // fresh answer (or the offline-stale flag) follows when it lands
  const applyResult = useCallback(async (id: number, result: HistoryFetchResult) => {
    if (id === requestId.current) {
      setState({ status: 'ready', items: result.items, stale: result.stale });
    }
    if (result.revalidate) {
      try {
        const fresh = await result.revalidate;
        if (id === requestId.current) {
          setState({ status: 'ready', items: fresh.items, stale: fresh.stale });
        }
      } catch {
        // Nothing newer to show — the placeholder stands
      }
    }
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    (async () => {
      try {
        const result = await fetchNearbyHistory({ latitude, longitude });
        await applyResult(id, result);
      } catch (error) {
        console.warn('Failed to load history:', error);
        if (id === requestId.current) {
          setState({ status: 'error' });
        }
      }
    })();
  }, [latitude, longitude, applyResult]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const result = await fetchNearbyHistory({ latitude, longitude }, { forceRefresh: true });
      await applyResult(id, result);
    } catch (error) {
      console.warn('Failed to refresh history:', error);
      if (id === requestId.current) {
        setState({ status: 'error' });
      }
    }
  }, [latitude, longitude, applyResult]);

  return { state, refresh };
}
