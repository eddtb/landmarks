import { renderHook, waitFor } from '@testing-library/react-native';

import { usePlaces } from '@/hooks/use-places';
import { placesByCategory } from '@/data/mock-places';

const mockFetchNearbyPlaces = jest.fn();

jest.mock('@/data/places-client', () => ({
  fetchNearbyPlaces: (...args: unknown[]) => mockFetchNearbyPlaces(...args),
}));

const Center = { latitude: 51.5055, longitude: -0.0906 };
const landmarks = placesByCategory('landmark', Center);

describe('usePlaces', () => {
  beforeEach(() => mockFetchNearbyPlaces.mockReset());

  test('loads places for the category and location', async () => {
    mockFetchNearbyPlaces.mockResolvedValue(landmarks);

    const { result } = await renderHook(() => usePlaces('landmark', Center));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(result.current.state).toMatchObject({ places: landmarks });
    expect(mockFetchNearbyPlaces).toHaveBeenCalledWith('landmark', Center);
  });

  test('errors surface as error state', async () => {
    mockFetchNearbyPlaces.mockRejectedValue(new Error('boom'));

    const { result } = await renderHook(() => usePlaces('landmark', Center));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
  });

  test('refresh reloads places', async () => {
    mockFetchNearbyPlaces.mockResolvedValueOnce(landmarks.slice(0, 1));
    const { result } = await renderHook(() => usePlaces('landmark', Center));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    mockFetchNearbyPlaces.mockResolvedValueOnce(landmarks);
    await result.current.refresh();

    await waitFor(() => expect(result.current.state).toMatchObject({ places: landmarks }));
    // Pull-to-refresh must bypass the session cache
    expect(mockFetchNearbyPlaces).toHaveBeenLastCalledWith('landmark', Center, {
      forceRefresh: true,
    });
  });
});
