import { useEffect, useState } from 'react';

import { fetchPlaceDetails, getCachedPlace } from '@/data/places-client';
import { Place, PlaceDetails } from '@/types/place';

export type PlaceDetailsState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'ready'; details: PlaceDetails };

/**
 * Two-tier fetch for the detail screen. The list's cached summary (when
 * present) renders instantly; rich details replace it when they arrive.
 * Cold starts (deep links) skip straight to the details fetch, so the
 * screen no longer depends on having visited the list first.
 */
export function usePlaceDetails(id: string): {
  summary: Place | undefined;
  state: PlaceDetailsState;
} {
  const summary = getCachedPlace(id);
  const [state, setState] = useState<PlaceDetailsState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const details = await fetchPlaceDetails(id);
        if (!cancelled) {
          setState(details ? { status: 'ready', details } : { status: 'not-found' });
        }
      } catch (error) {
        console.warn('Failed to load place details:', error);
        if (!cancelled) {
          // Keep whatever the summary shows; only report not-found without one
          setState({ status: 'not-found' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return { summary, state };
}
