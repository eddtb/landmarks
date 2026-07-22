import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useHistory } from '@/hooks/use-history';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const mockFetchNearbyHistory = jest.fn();

jest.mock('@/data/history-client', () => ({
  fetchNearbyHistory: (...args: unknown[]) => mockFetchNearbyHistory(...args),
}));

const item = {
  pageId: 42,
  title: 'Borough Compter',
  coordinates: { latitude: 51.5045, longitude: -0.0905 },
  distanceMeters: 112,
  url: 'https://en.wikipedia.org/wiki/Borough_Compter',
  source: 'Wikipedia',
} as HistoryItem;

describe('useHistory bucket quantization', () => {
  beforeEach(() => {
    mockFetchNearbyHistory.mockReset();
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
  });

  test('fetches with 3 dp coords — the server bucket, not the raw fix', async () => {
    const { result } = await renderHook(() => useHistory({ latitude: 51.5041, longitude: -0.0902 }));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetchNearbyHistory).toHaveBeenCalledWith({ latitude: 51.504, longitude: -0.09 });
  });

  test('a GPS tick inside the bucket refires nothing; crossing a bucket refetches', async () => {
    const { result, rerender } = await renderHook(
      ({ center }: { center: Coordinates }) => useHistory(center),
      { initialProps: { center: { latitude: 51.5041, longitude: -0.0902 } } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // ~25m of drift — same ~111m bucket, and the old 4 dp deps would
    // have refired a whole feed fetch here
    await rerender({ center: { latitude: 51.5043, longitude: -0.0904 } });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // A real bucket crossing still re-asks
    await rerender({ center: { latitude: 51.5061, longitude: -0.0904 } });
    await waitFor(() => expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2));
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith({ latitude: 51.506, longitude: -0.09 });
  });
});

describe('useHistory setState bail', () => {
  beforeEach(() => mockFetchNearbyHistory.mockReset());

  test('the same cached result object leaves state untouched', async () => {
    // history-client returns the IDENTICAL feed object for a repeated
    // bucket hit — applying it again must not mint new state (which
    // would re-render the whole feed every walking tick)
    const feed = { items: [item] };
    mockFetchNearbyHistory.mockResolvedValue(feed);
    const { result } = await renderHook(() =>
      useHistory({ latitude: 51.5041, longitude: -0.0902 })
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const before = result.current.state;

    await act(() => result.current.refresh());
    expect(result.current.state).toBe(before); // bailed — same items, same flags

    // Control: a genuinely different answer still lands
    mockFetchNearbyHistory.mockResolvedValue({ items: [{ ...item, pageId: 43 }] });
    await act(() => result.current.refresh());
    expect(result.current.state).not.toBe(before);
  });

  test('a changed flag on the same items is still a state change', async () => {
    const items = [item];
    mockFetchNearbyHistory.mockResolvedValue({ items });
    const { result } = await renderHook(() =>
      useHistory({ latitude: 51.5041, longitude: -0.0902 })
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const before = result.current.state;

    // Same items array, but now served offline-stale — the honesty
    // flag must not be swallowed by the bail
    mockFetchNearbyHistory.mockResolvedValue({ items, stale: true });
    await act(() => result.current.refresh());
    expect(result.current.state).not.toBe(before);
    expect(result.current.state).toMatchObject({ status: 'ready', stale: true });
  });
});
