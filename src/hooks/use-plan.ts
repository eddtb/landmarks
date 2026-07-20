import { useSyncExternalStore } from 'react';

import { getWalkStops, subscribeToWalk } from '@/data/plan-store';

/** The live walk — re-renders on add/remove/reorder/clear. */
export function usePlan() {
  return useSyncExternalStore(subscribeToWalk, getWalkStops, getWalkStops);
}
