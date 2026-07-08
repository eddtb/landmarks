import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyPlaces } from '@/data/places-client';
import { PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates } from '@/utils/geo';

export type PlacesState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; places: PlaceWithDistance[]; hasMore: boolean };

export function usePlaces(
  category: PlaceCategory,
  center: Coordinates
): {
  state: PlacesState;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  loadingMore: boolean;
} {
  const [state, setState] = useState<PlacesState>({ status: 'loading' });
  const [loadingMore, setLoadingMore] = useState(false);
  const { latitude, longitude } = center;

  // Guards against out-of-order responses when the user switches sections
  // faster than requests resolve: only the latest request may set state.
  const requestId = useRef(0);
  const nextPageToken = useRef<string | undefined>(undefined);

  // Previous results stay visible while a new section loads (no spinner
  // flash); the request-id guard keeps responses in order.
  useEffect(() => {
    const id = ++requestId.current;
    (async () => {
      try {
        const page = await fetchNearbyPlaces(category, { latitude, longitude });
        if (id === requestId.current) {
          nextPageToken.current = page.nextPageToken;
          setState({ status: 'ready', places: page.places, hasMore: !!page.nextPageToken });
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
      const page = await fetchNearbyPlaces(category, { latitude, longitude });
      if (id === requestId.current) {
        nextPageToken.current = page.nextPageToken;
        setState({ status: 'ready', places: page.places, hasMore: !!page.nextPageToken });
      }
    } catch (error) {
      console.warn('Failed to refresh places:', error);
      if (id === requestId.current) {
        setState({ status: 'error' });
      }
    }
  }, [category, latitude, longitude]);

  const loadMore = useCallback(async () => {
    const token = nextPageToken.current;
    if (!token || loadingMore) {
      return;
    }
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const page = await fetchNearbyPlaces(category, { latitude, longitude }, token);
      if (id === requestId.current) {
        nextPageToken.current = page.nextPageToken;
        setState((current) => {
          if (current.status !== 'ready') {
            return current;
          }
          // Dedupe on append — pagination should not repeat, but be safe
          const seen = new Set(current.places.map((place) => place.id));
          const fresh = page.places.filter((place) => !seen.has(place.id));
          return {
            status: 'ready',
            places: [...current.places, ...fresh],
            hasMore: !!page.nextPageToken,
          };
        });
      }
    } catch (error) {
      // Loading more is best-effort: keep what we have, allow retrying
      console.warn('Failed to load more places:', error);
    } finally {
      if (id === requestId.current) {
        setLoadingMore(false);
      }
    }
  }, [category, latitude, longitude, loadingMore]);

  return { state, refresh, loadMore, loadingMore };
}
