import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyHistory } from '@/data/history-client';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: HistoryItem[] };

export function useHistory(center: Coordinates): {
  state: HistoryState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const { latitude, longitude } = center;
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    (async () => {
      try {
        const items = await fetchNearbyHistory({ latitude, longitude });
        if (id === requestId.current) {
          setState({ status: 'ready', items });
        }
      } catch (error) {
        console.warn('Failed to load history:', error);
        if (id === requestId.current) {
          setState({ status: 'error' });
        }
      }
    })();
  }, [latitude, longitude]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const items = await fetchNearbyHistory({ latitude, longitude }, { forceRefresh: true });
      if (id === requestId.current) {
        setState({ status: 'ready', items });
      }
    } catch (error) {
      console.warn('Failed to refresh history:', error);
      if (id === requestId.current) {
        setState({ status: 'error' });
      }
    }
  }, [latitude, longitude]);

  return { state, refresh };
}
