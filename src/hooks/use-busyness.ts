import { useEffect, useState } from 'react';

import { fetchBusyness } from '@/data/busyness-client';
import { BusynessPattern } from '@/types/busyness';
import { Place } from '@/types/place';

export type BusynessState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; pattern: BusynessPattern };

/** "Worth the walk?" is a food/drink/activity question — landmarks keep quiet. */
const EligibleCategories = new Set(['food', 'drink', 'activity']);

export function useBusyness(place: Place | undefined): BusynessState {
  const eligible = !!place && EligibleCategories.has(place.category);
  const [state, setState] = useState<BusynessState>(
    eligible ? { status: 'loading' } : { status: 'none' }
  );

  useEffect(() => {
    if (!place || !eligible) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const pattern = await fetchBusyness(place);
        if (!cancelled) {
          setState(pattern ? { status: 'ready', pattern } : { status: 'none' });
        }
      } catch (error) {
        console.warn('Failed to load busyness:', error);
        if (!cancelled) {
          setState({ status: 'none' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, eligible]);

  return state;
}
