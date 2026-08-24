import { act, renderHook, waitFor } from '@testing-library/react-native';

import { resetFeedOriginForTests } from '@/hooks/use-feed-origin';
import { useHistory } from '@/hooks/use-history';
import { clearPin, setPin, usePin } from '@/hooks/use-pin';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const mockFetchNearbyHistory = jest.fn();
const mockHasCachedFeed = jest.fn().mockReturnValue(false);

jest.mock('@/data/history-client', () => ({
  fetchNearbyHistory: (...args: unknown[]) => mockFetchNearbyHistory(...args),
  hasCachedFeed: (...args: unknown[]) => mockHasCachedFeed(...args),
}));

const item = {
  pageId: 42,
  title: 'Borough Compter',
  coordinates: { latitude: 51.5045, longitude: -0.0905 },
  distanceMeters: 112,
  url: 'https://en.wikipedia.org/wiki/Borough_Compter',
  source: 'Wikipedia',
} as HistoryItem;

const home: Coordinates = { latitude: 51.5041, longitude: -0.0902 };
/** ~25m of drift — the same ~111m bucket. */
const homeDrift: Coordinates = { latitude: 51.5043, longitude: -0.0904 };
/** The next bucket over (~220m) — the old deps refired a fetch here. */
const nextBucket: Coordinates = { latitude: 51.5061, longitude: -0.0904 };
/** A bus ride away (~2km) — eighteen buckets crossed. */
const busStop: Coordinates = { latitude: 51.522, longitude: -0.0904 };
const alnwick: Coordinates = { latitude: 55.4135, longitude: -1.7055 };

beforeEach(() => {
  // Module-level stores — the pin and the feed origin both outlive a
  // render, so every test starts unpinned and unanchored
  clearPin();
  resetFeedOriginForTests();
});

/** The gate's own wiring, in miniature: the centre IS the pin while one
 * is set — they change together, in one commit, which is how
 * LocationGate derives it — and the GPS fix otherwise. Pin tests drive
 * this rather than handing the hook a centre the gate never produces
 * (a cleared pin with the old pin's coordinates still as centre). */
function useGatedHistory({ gps }: { gps: Coordinates }) {
  const pin = usePin();
  return useHistory(pin?.center ?? gps);
}

describe('useHistory asks from the feed origin (#323)', () => {
  beforeEach(() => {
    mockFetchNearbyHistory.mockReset();
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
  });

  test('fetches with 3 dp coords — the server bucket, not the raw fix', async () => {
    const { result } = await renderHook(() => useHistory(home));

    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetchNearbyHistory).toHaveBeenCalledWith({ latitude: 51.504, longitude: -0.09 });
  });

  test('movement never refires the feed: not a tick, not a bucket, not a bus ride', async () => {
    const { result, rerender } = await renderHook(
      ({ center }: { center: Coordinates }) => useHistory(center),
      { initialProps: { center: home } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    await rerender({ center: homeDrift });
    await rerender({ center: nextBucket });
    await rerender({ center: busStop });
    await act(async () => {});

    // One ask, ever — the bucket crossings that used to refire a whole
    // feed fetch (every ~8s on a bus) fire nothing at all
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);
    expect(result.current.state).toMatchObject({ status: 'ready', items: [item] });
  });

  test('a searched pin refetches at the pin; release refetches where the reader is NOW', async () => {
    const { result, rerender } = await renderHook(useGatedHistory, {
      initialProps: { gps: home },
    });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // The reader pins Alnwick — a deliberate act, the feed follows
    await act(() => setPin({ center: alnwick, blind: false, label: 'Alnwick' }));
    await waitFor(() => expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2));
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith({ latitude: 55.413, longitude: -1.706 });

    // They ride across town while exploring — still nothing refires…
    await rerender({ gps: busStop });
    await act(async () => {});
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);

    // …and Back to near me re-asks about the ground they are actually
    // on, not where they pinned from
    await act(() => clearPin());
    await waitFor(() => expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(3));
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith({ latitude: 51.522, longitude: -0.09 });
  });
});

describe('the pull re-asks from where the reader is now (#323)', () => {
  beforeEach(() => {
    mockFetchNearbyHistory.mockReset();
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
  });

  test('unmoved, a pull is the deliberate everything-bypass', async () => {
    const { result } = await renderHook(() => useHistory(home));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    await act(() => result.current.refresh());

    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith(
      { latitude: 51.504, longitude: -0.09 },
      { forceRefresh: true }
    );
  });

  test('moved, a pull re-anchors: fresh ground, a plain ask — the margin line kept its promise', async () => {
    const { result, rerender } = await renderHook(
      ({ center }: { center: Coordinates }) => useHistory(center),
      { initialProps: { center: home } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    // The bus ride: no fetch (asserted above), and then the reader pulls
    await rerender({ center: busStop });
    await act(() => result.current.refresh());

    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
    // A plain ask about the new bucket — fresh=1 is for re-asking about
    // ground the server already answered, which this is not
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith({ latitude: 51.522, longitude: -0.09 });
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
    const { result } = await renderHook(() => useHistory(home));
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
    const { result } = await renderHook(() => useHistory(home));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    const before = result.current.state;

    // Same items array, but now served offline-stale — the honesty
    // flag must not be swallowed by the bail
    const savedAt = Date.now() - 3 * 60 * 60 * 1000;
    mockFetchNearbyHistory.mockResolvedValue({ items, stale: true, savedAt });
    await act(() => result.current.refresh());
    expect(result.current.state).not.toBe(before);
    // Both halves reach the screens: the admission AND the day it names
    expect(result.current.state).toMatchObject({ status: 'ready', stale: true, savedAt });
  });

  test('a failed feed carries WHY, so the panel can say what came back', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ApiError } = require('@/data/cached-get') as typeof import('@/data/cached-get');
    mockFetchNearbyHistory.mockRejectedValue(new ApiError('History', 502));
    const { result } = await renderHook(() => useHistory(home));

    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toEqual({ status: 'error', verdict: 'errored' });

    // …and a request that never completed is a different verdict
    mockFetchNearbyHistory.mockRejectedValue(new TypeError('Network request failed'));
    await act(() => result.current.refresh());
    expect(result.current.state).toEqual({ status: 'error', verdict: 'silent' });
  });
});

describe('useHistory dressing upgrade (the early-serve contract, #201)', () => {
  const flush = () => act(async () => {});

  beforeEach(() => {
    jest.useFakeTimers();
    mockFetchNearbyHistory.mockReset();
    mockHasCachedFeed.mockReset();
    mockHasCachedFeed.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a dressing result fires EXACTLY one upgrade re-fetch at ~4s, and the dressed items replace the undressed', async () => {
    const dressedItems = [{ ...item, thumbnailUrl: 'https://img/1.jpg' }];
    mockFetchNearbyHistory
      .mockResolvedValueOnce({ items: [item], dressing: true })
      .mockResolvedValueOnce({ items: dressedItems });
    const { result } = await renderHook(() => useHistory(home));
    await flush();
    expect(result.current.state).toMatchObject({ status: 'ready', items: [item] });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // Nothing fires early…
    await act(async () => {
      jest.advanceTimersByTime(3999);
    });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // …the one-shot fires at 4s as an upgrade (client-cache bypass, no fresh=1)
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith(
      { latitude: 51.504, longitude: -0.09 },
      { upgrade: true }
    );
    expect(result.current.state).toMatchObject({ status: 'ready', items: dressedItems });

    // …and never again: no loop, no poll storm
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
  });

  test('an upgrade that comes back still dressing does NOT schedule another — the flag is one-shot, not a loop', async () => {
    mockFetchNearbyHistory.mockResolvedValue({ items: [item], dressing: true });
    await renderHook(() => useHistory(home));
    await flush();

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
  });

  test('movement neither cancels the pending upgrade nor asks again — the origin still gets dressed (#323)', async () => {
    const dressedItems = [{ ...item, thumbnailUrl: 'https://img/1.jpg' }];
    mockFetchNearbyHistory
      .mockResolvedValueOnce({ items: [item], dressing: true })
      .mockResolvedValueOnce({ items: dressedItems });
    const { result, rerender } = await renderHook(
      ({ center }: { center: Coordinates }) => useHistory(center),
      { initialProps: { center: home } }
    );
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // Walk into the next bucket before the 4s lands — under the old
    // deps this cancelled the upgrade AND fired a whole new fetch
    await rerender({ center: nextBucket });
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await flush();
    // The ONE upgrade fires, for the origin's own bucket
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith(
      { latitude: 51.504, longitude: -0.09 },
      { upgrade: true }
    );
    expect(result.current.state).toMatchObject({ status: 'ready', items: dressedItems });

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
  });

  test('a pin move cancels the pending upgrade — the new ground earns its own', async () => {
    mockFetchNearbyHistory
      .mockResolvedValueOnce({ items: [item], dressing: true })
      .mockResolvedValue({ items: [item] }); // the pinned bucket answers dressed
    await renderHook(useGatedHistory, { initialProps: { gps: home } });
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(1);

    // Pin Alnwick before the 4s lands
    await act(() => setPin({ center: alnwick, blind: false, label: 'Alnwick' }));
    await flush();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2); // the pin's own fetch

    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    // The old ground's upgrade never fires: no call carries upgrade:true
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2);
    expect(
      mockFetchNearbyHistory.mock.calls.some(([, options]) => options?.upgrade)
    ).toBe(false);
  });
});

describe('useHistory loading honesty on an origin jump', () => {
  beforeEach(() => {
    mockFetchNearbyHistory.mockReset();
    mockHasCachedFeed.mockReset();
    mockHasCachedFeed.mockReturnValue(false);
  });

  test('a pin jump to an uncached place drops to loading — never the old feed under a new header', async () => {
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
    const { result } = await renderHook(useGatedHistory, { initialProps: { gps: home } });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    // A manual pin: Greenwich → Alnwick, nothing cached there, and the
    // fetch takes its 10-20 seconds — the window the probe caught
    mockFetchNearbyHistory.mockReturnValue(new Promise(() => {}));
    await act(() => setPin({ center: alnwick, blind: false, label: 'Alnwick' }));

    await waitFor(() => expect(result.current.state.status).toBe('loading'));
  });

  test('a pin jump to a cached bucket hands over seamlessly — ready throughout', async () => {
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
    const { result } = await renderHook(useGatedHistory, { initialProps: { gps: home } });
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    // The new bucket has a feed to paint (fresh or expired placeholder)
    mockHasCachedFeed.mockReturnValue(true);
    const cachedFeed = { items: [{ ...item, pageId: 43, title: 'Alnwick Castle' }] };
    mockFetchNearbyHistory.mockResolvedValue(cachedFeed);
    await act(() => setPin({ center: alnwick, blind: false, label: 'Alnwick' }));

    // Never a loading flash: the state stays ready across the handover
    expect(result.current.state.status).toBe('ready');
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ status: 'ready', items: cachedFeed.items })
    );
  });

  test('movement keeps the feed ready — the ground on screen is still the ground it was asked about', async () => {
    mockFetchNearbyHistory.mockResolvedValue({ items: [item] });
    const { result, rerender } = await renderHook(
      ({ center }: { center: Coordinates }) => useHistory(center),
      { initialProps: { center: home } }
    );
    await waitFor(() => expect(result.current.state.status).toBe('ready'));

    // The bus ride: uncached ground everywhere, and no loading state —
    // the feed is not ABOUT the new ground until the reader pulls
    await rerender({ center: busStop });
    await act(async () => {});
    expect(result.current.state).toMatchObject({ status: 'ready', items: [item] });
  });
});
