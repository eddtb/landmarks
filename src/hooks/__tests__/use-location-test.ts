import { renderHook, waitFor } from '@testing-library/react-native';

import { useLocation } from '@/hooks/use-location';

const mockUseForegroundPermissions = jest.fn();
const mockGetLastKnownPositionAsync = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();

jest.mock('expo-location', () => ({
  useForegroundPermissions: () => mockUseForegroundPermissions(),
  getLastKnownPositionAsync: () => mockGetLastKnownPositionAsync(),
  getCurrentPositionAsync: () => mockGetCurrentPositionAsync(),
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
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 51.5, longitude: -0.09 },
    });
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

  test('fetches a position once granted and becomes ready', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    const { result } = await renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.coordinates).toEqual({ latitude: 51.5, longitude: -0.09 });
  });

  test('uses the last known position while waiting for a fresh fix', async () => {
    permissionState({ granted: true, status: 'granted', canAskAgain: true });
    mockGetLastKnownPositionAsync.mockResolvedValue({
      coords: { latitude: 51.49, longitude: -0.1 },
    });
    // Fresh fix never resolves in this test
    mockGetCurrentPositionAsync.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => useLocation());

    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.coordinates).toEqual({ latitude: 51.49, longitude: -0.1 });
  });
});
