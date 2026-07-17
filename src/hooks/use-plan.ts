import { useSyncExternalStore } from 'react';

import { getPlanItems, subscribeToPlan } from '@/data/plan-store';

/** The live plan — re-renders on add/remove/reorder/clear. */
export function usePlan() {
  return useSyncExternalStore(subscribeToPlan, getPlanItems, getPlanItems);
}
