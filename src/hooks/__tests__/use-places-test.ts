import { renderHook, waitFor } from '@testing-library/react-native';

import { usePlaces } from '@/hooks/use-places';
import { placesByCategory } from '@/data/mock-places';

const mockFetchNearbyPlaces = jest.fn();

jest.mock('@/data/places-client', () => ({
  fetchNearbyPlaces: (...args: unknown[]) => mockFetchNearbyPlaces(...args),
}));

const Center = { latitude: 51.5055, longitude: -0.0906 };
const landmarks = placesByCategory('landmark', Center);
const pageOne = landmarks.slice(0, 2);
const pageTwo = landmarks.slice(2, 4);

describe('usePlaces', () => {
  beforeEach(() => mockFetchNearbyPlaces.mockReset());

  test('loads the first page and reports whether more exist', async () => {
    mockFetchNearbyPlaces.mockResolvedValue({ places: pageOne, nextPageToken: 'page-2' });

    const { result } = await renderHook(() => usePlaces('landmark', Center));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({ places: pageOne, hasMore: true });
  });

  test('loadMore appends the next page and stops at the end', async () => {
    mockFetchNearbyPlaces
      .mockResolvedValueOnce({ places: pageOne, nextPageToken: 'page-2' })
      .mockResolvedValueOnce({ places: pageTwo, nextPageToken: undefined });

    const { result } = await renderHook(() => usePlaces('landmark', Center));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await result.current.loadMore();

    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        places: [...pageOne, ...pageTwo],
        hasMore: false,
      })
    );
    // Second call carried the page token
    expect(mockFetchNearbyPlaces).toHaveBeenLastCalledWith('landmark', Center, 'page-2');

    // No token left — loadMore is now a no-op
    await result.current.loadMore();
    expect(mockFetchNearbyPlaces).toHaveBeenCalledTimes(2);
  });

  test('loadMore drops duplicates across pages', async () => {
    mockFetchNearbyPlaces
      .mockResolvedValueOnce({ places: pageOne, nextPageToken: 'page-2' })
      .mockResolvedValueOnce({ places: [pageOne[0], ...pageTwo], nextPageToken: undefined });

    const { result } = await renderHook(() => usePlaces('landmark', Center));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await result.current.loadMore();

    await waitFor(() => {
      const state = result.current.state;
      expect(state.status).toBe('ready');
      if (state.status === 'ready') {
        const ids = state.places.map((place) => place.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    });
  });

  test('a failed loadMore keeps the current list', async () => {
    mockFetchNearbyPlaces
      .mockResolvedValueOnce({ places: pageOne, nextPageToken: 'page-2' })
      .mockRejectedValueOnce(new Error('boom'));

    const { result } = await renderHook(() => usePlaces('landmark', Center));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await result.current.loadMore();

    expect(result.current.state).toMatchObject({ status: 'ready', places: pageOne });
  });

  test('errors on the first page surface as error state', async () => {
    mockFetchNearbyPlaces.mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => usePlaces('landmark', Center));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });
});
