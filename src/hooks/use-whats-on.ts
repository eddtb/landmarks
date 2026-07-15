import { useEffect, useState } from 'react';

import { fetchWhatsOn } from '@/data/whats-on-client';
import { Place } from '@/types/place';
import { WhatsOnEvent } from '@/types/whats-on';

export type WhatsOnState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; events: WhatsOnEvent[] };

/** Recurring events are a Drinks/Activities thing — a café quiz is rare
 * enough that searching every bakery isn't worth the pennies. */
const EligibleCategories = new Set(['drink', 'activity']);

/**
 * Resolves the "What's on" section for a place. Only drink and activity
 * venues are looked up; "no events" is a normal outcome and renders
 * nothing.
 */
export function useWhatsOn(place: Place | undefined): WhatsOnState {
  const eligible = !!place && EligibleCategories.has(place.category);
  const [state, setState] = useState<WhatsOnState>(
    eligible ? { status: 'loading' } : { status: 'none' }
  );

  useEffect(() => {
    if (!place || !eligible) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const events = await fetchWhatsOn(place);
        if (!cancelled) {
          setState(events.length > 0 ? { status: 'ready', events } : { status: 'none' });
        }
      } catch (error) {
        console.warn("Failed to load what's on:", error);
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
