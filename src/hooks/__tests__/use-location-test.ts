import { renderHook, waitFor } from '@testing-library/react-native';

import { useLocation } from '@/hooks/use-location';

const mockUseForegroundPermissions = jest.fn();
const mockGetLastKnownPositionAsync = jest.fn();
const mockWatchPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  useForegroundPermissions: () => mockUseForegroundPermissions(),
  getLastKnownPositionAsync: () => mockGetLastKnownPositionAsync(),
  watchPositionAsync: (...args: unknown[]) => mockWatchPositionAsync(...args),
  Accuracy: { Balanced: 3 },
}));

const requestFn = jest.fn();

function permissionState(overrides: object | null) {
  mockUseForegroundPermissions.mockReturnValue([overrides, requestFn]);
}

describe('useLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLastKnownPositionAsync.mockResolvedValue(null);
    // Default watch: emits one fix immediately, returns a removable subscription
    mockWatchPositionAsync.mockImplementation(
      async (_options: unknown, callback: (update: { coords: object }) => void) => {
        callback({ coords: { latitude: 51.5, longitude: -0.09 } });
        return { remove: jest.fn() };
      }
    );
  });

  test('is loading before the permission state is known', async () => {
    permissionState(null);
    const { result } = await renderHook(() => useLocation());
    expect(result.current.status).toBe('loading');
  });

  test('primes when permission has never been requested', async () => {
    permissionState({ granted: false, status: 'undetermined', canAskAgain: true });
    const { result } = await renderHook(() => useLocation());
    expect(result.current.status).toBe('priming');
  });

  test('reports denied when the user refused', async () => {
    permissionState({ granted: false, status: 'denied', canAskAgain: false });
    const { result } = await renderHook(() => useLocation());
    expect(result.current.status).toBe('denied');
    expect(result.current.coordinates).toBeNull();
  });

  test('starts the position watch once granted and becomes ready', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    const { result } = await renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.coordinates).toEqual({ latitude: 51.5, longitude: -0.09 });
  });

  test('uses the last known position while waiting for the first watch fix', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 51.49, longitude: -0.1 },
    });
    // Watch never emits in this test
    mockWatchPositionAsync.mockResolvedValue({ remove: jest.fn() });

    const { result } = await renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.coordinates).toEqual({ latitude: 51.49, longitude: -0.1 });
  });

  test('live watch updates replace the coordinates as the user moves', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    let emit: ((update: { coords: object }) => void) | undefined;
    mockWatchPositionAsync.mockImplementation(
      async (_options: unknown, callback: (update: { coords: object }) => void) => {
        emit = callback;
        callback({ coords: { latitude: 51.5, longitude: -0.09 } });
        return { remove: jest.fn() };
      }
    );

    const { result } = await renderHook(() => useLocation());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    // The user walks ~100m north
    await waitFor(() => {
      emit!({ coords: { latitude: 51.501, longitude: -0.09 } });
      expect(result.current.coordinates).toEqual({ latitude: 51.501, longitude: -0.09 });
    });
  });

  test('removes the watch subscription on unmount', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    const remove = jest.fn();
    mockWatchPositionAsync.mockResolvedValue({ remove });

    const { unmount } = await renderHook(() => useLocation());
    await waitFor(() => expect(mockWatchPositionAsync).toHaveBeenCalled());
    unmount();

    await waitFor(() => expect(remove).toHaveBeenCalled());
  });
});
