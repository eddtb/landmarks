import { useEffect, useState } from 'react';

import { fetchBlurb } from '@/data/blurb-client';
import { Place } from '@/types/place';

export type BlurbState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; blurb: string };

/**
 * The description of last resort — only consulted when the caller has
 * confirmed there is no Wikipedia story and no Google editorial text.
 * A decline ("none") is a normal outcome.
 */
export function useBlurb(place: Place | undefined, enabled: boolean): BlurbState {
  const [state, setState] = useState<BlurbState>({ status: 'idle' });

  useEffect(() => {
    if (!place || !enabled) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const blurb = await fetchBlurb(place);
        if (!cancelled) {
          setState(blurb ? { status: 'ready', blurb } : { status: 'none' });
        }
      } catch (error) {
        console.warn('Failed to load blurb:', error);
        if (!cancelled) {
          setState({ status: 'none' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, enabled]);

  return state;
}
