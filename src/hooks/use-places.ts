import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyPlaces } from '@/data/places-client';
import { PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates } from '@/utils/geo';

export type PlacesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; places: PlaceWithDistance[] };

export function usePlaces(
  category: PlaceCategory,
  center: Coordinates
): { state: PlacesState; refresh: () => Promise<void> } {
  const [state, setState] = useState<PlacesState>({ status: 'loading' });
  const { latitude, longitude } = center;

  // Guards against out-of-order responses when the user switches sections
  // faster than requests resolve: only the latest request may set state.
  const requestId = useRef(0);

  // Previous results stay visible while a new section loads (no spinner
  // flash); the request-id guard keeps responses in order.
  useEffect(() => {
    const id = ++requestId.current;
    (async () => {
      try {
        const places = await fetchNearbyPlaces(category, { latitude, longitude });
        if (id === requestId.current) {
          setState({ status: 'ready', places });
        }
      } catch (error) {
        console.warn('Failed to load places:', error);
        if (id === requestId.current) {
          setState({ status: 'error' });
        }
      }
    })();
  }, [category, latitude, longitude]);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const places = await fetchNearbyPlaces(
        category,
        { latitude, longitude },
        { forceRefresh: true }
      );
      if (id === requestId.current) {
        setState({ status: 'ready', places });
      }
    } catch (error) {
      console.warn('Failed to refresh places:', error);
      if (id === requestId.current) {
        setState({ status: 'error' });
      }
    }
  }, [category, latitude, longitude]);

  return { state, refresh };
}
