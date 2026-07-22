import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyHistory, hasCachedFeed, HistoryFetchResult } from '@/data/history-client';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; items: HistoryItem[]; sparse?: boolean; stale?: boolean };

export function useHistory(center: Coordinates): {
  state: HistoryState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  // Quantized to the server's own 3 dp bucket (~111m): GPS ticks every
  // ~10m, and effect deps finer than the bucket refired a whole feed
  // fetch per tick. The raw center never enters this hook — it keeps
  // flowing to standing-on/distance labels in the components untouched.
  const latitude = Number(center.latitude.toFixed(3));
  const longitude = Number(center.longitude.toFixed(3));
  const requestId = useRef(0);

  // An expired persisted bucket paints instantly as a placeholder; the
  // fresh answer (or the offline-stale flag) follows when it lands.
  // Both honesty flags ride through: sparse (the server looked further)
  // and stale (a network failure forced serving saved stories).
  //
  // Same answer, same state: a repeated bucket hit returns the cache's
  // own result object (see history-client), so identical items + flags
  // bail out of setState instead of re-rendering the feed every tick.
  const applyResult = useCallback(async (id: number, result: HistoryFetchResult) => {
    const apply = (next: HistoryFetchResult) =>
      setState((prev) =>
        prev.status === 'ready' &&
        prev.items === next.items &&
        prev.sparse === next.sparse &&
        prev.stale === next.stale
          ? prev
          : { status: 'ready', items: next.items, sparse: next.sparse, stale: next.stale }
      );
    if (id === requestId.current) {
      apply(result);
    }
    if (result.revalidate) {
      try {
        const fresh = await result.revalidate;
        if (id === requestId.current) {
          apply(fresh);
        }
      } catch {
        // Nothing newer to show — the placeholder stands
      }
    }
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    // Loading honesty on a bucket jump: this effect only refires when
    // the BUCKET changes (walking ticks inside one don't), and if the
    // new bucket has nothing cached the old area's feed — old-area
    // distances and all — must not keep painting under the new header
    // for the fetch window. A cached bucket (adjacent ground while
    // walking, revisits) still hands over seamlessly, no flash.
    (async () => {
      if (!hasCachedFeed({ latitude, longitude })) {
        setState((prev) => (prev.status === 'loading' ? prev : { status: 'loading' }));
      }
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
