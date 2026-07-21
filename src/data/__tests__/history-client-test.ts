import AsyncStorage from '@react-native-async-storage/async-storage';

import { HistoryItem } from '@/types/history';

const mockFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const item = {
  pageId: 42,
  title: 'Borough Compter',
  coordinates: { latitude: 51.5045, longitude: -0.0905 },
  distanceMeters: 112,
  url: 'https://en.wikipedia.org/wiki/Borough_Compter',
  source: 'Wikipedia',
} as HistoryItem;

function persistedItem(pageId: number, title: string): HistoryItem {
  return { ...item, pageId, title };
}

const HourMs = 60 * 60 * 1000;

// Seed "last session's" persisted buckets BEFORE the client module
// loads — its caches hydrate at import, so this is the app relaunching
// after a force-quit. Keys are the client's own ~11m grid buckets;
// values are whole feeds (items plus sparse metadata).
const store = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
  .__INTERNAL_MOCK_STORAGE__;
store['cache-history-feed-v1'] = JSON.stringify([
  [
    '50.1000|-0.0900',
    { value: { items: [persistedItem(1, 'Persisted Fresh')] }, at: Date.now() },
  ],
  [
    '50.2000|-0.0900',
    { value: { items: [persistedItem(2, 'Persisted Stale')] }, at: Date.now() - 2 * HourMs },
  ],
  [
    '50.3000|-0.0900',
    { value: { items: [persistedItem(3, 'Persisted Offline')] }, at: Date.now() - 2 * HourMs },
  ],
  [
    '50.4000|-0.0900',
    {
      value: { items: [persistedItem(4, 'Persisted Sparse Village')], sparse: true },
      at: Date.now() - 2 * HourMs,
    },
  ],
]);
store['cache-history-item-v1'] = JSON.stringify([
  ['7', { value: persistedItem(7, 'Persisted Detail'), at: Date.now() }],
]);

const { fetchNearbyHistory, fetchStory, getCachedHistoryItem } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/data/history-client') as typeof import('@/data/history-client');

let latSeed = 51.6;
function freshCenter() {
  latSeed += 0.01;
  return { latitude: latSeed, longitude: -0.09 };
}

describe('fetchNearbyHistory', () => {
  beforeEach(() => mockFetch.mockReset());

  test('requests /api/history and caches the list and items', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });
    const center = freshCenter();

    const first = await fetchNearbyHistory(center);
    const second = await fetchNearbyHistory(center);

    expect(mockFetch.mock.calls[0][0]).toContain('/api/history?');
    expect(first.items).toHaveLength(1);
    expect(first.sparse).toBeUndefined();
    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getCachedHistoryItem(42)?.title).toBe('Borough Compter');
  });

  test('surfaces the sparse flag when the server widened its search', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [item], sparse: true, horizon: 3000 }),
    });

    const feed = await fetchNearbyHistory(freshCenter());

    expect(feed.sparse).toBe(true);
    expect(feed.items).toHaveLength(1);
  });

  test('forceRefresh bypasses the cache', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [] }) });
    const center = freshCenter();

    await fetchNearbyHistory(center);
    await fetchNearbyHistory(center, { forceRefresh: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('fresh=1');
  });

  test('throws on failed responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(fetchNearbyHistory(freshCenter())).rejects.toThrow('502');
  });
});

describe('fetchNearbyHistory persistence (relaunch simulated by pre-import seeding)', () => {
  beforeEach(() => mockFetch.mockReset());

  test("last session's fresh bucket is served instantly, no fetch", async () => {
    const result = await fetchNearbyHistory({ latitude: 50.1, longitude: -0.09 });

    expect(result.items[0].title).toBe('Persisted Fresh');
    expect(result.stale).toBeUndefined();
    expect(result.revalidate).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('an hour-stale bucket paints instantly as a placeholder and revalidates', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });

    const result = await fetchNearbyHistory({ latitude: 50.2, longitude: -0.09 });
    expect(result.items[0].title).toBe('Persisted Stale'); // shown while the re-ask runs
    expect(result.stale).toBeUndefined(); // not offline — just re-asking

    const fresh = await result.revalidate!;
    expect(fresh.items[0].title).toBe('Borough Compter');
    expect(fresh.stale).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // The revalidated bucket is live again — no further fetch
    const again = await fetchNearbyHistory({ latitude: 50.2, longitude: -0.09 });
    expect(again.items[0].title).toBe('Borough Compter');
    expect(again.revalidate).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('network failure with a saved bucket serves it flagged stale', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    const result = await fetchNearbyHistory({ latitude: 50.3, longitude: -0.09 });
    expect(result.items[0].title).toBe('Persisted Offline'); // placeholder first

    const offline = await result.revalidate!;
    expect(offline.stale).toBe(true); // the flag HistoryBody's note hangs on
    expect(offline.items[0].title).toBe('Persisted Offline');
  });

  test('a persisted sparse bucket round-trips its flag — offline, the honesty survives', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    const result = await fetchNearbyHistory({ latitude: 50.4, longitude: -0.09 });
    expect(result.items[0].title).toBe('Persisted Sparse Village');
    expect(result.sparse).toBe(true); // the placeholder already says "we looked further"

    const offline = await result.revalidate!;
    expect(offline.stale).toBe(true);
    expect(offline.sparse).toBe(true); // served offline-stale, the sparse copy survives
  });

  test('a failed forced refresh falls back to the saved bucket, flagged', async () => {
    const center = freshCenter();
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item] }) });
    await fetchNearbyHistory(center);

    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    const result = await fetchNearbyHistory(center, { forceRefresh: true });

    expect(result.stale).toBe(true);
    expect(result.items[0].title).toBe('Borough Compter');
  });

  test('network failure with nothing saved still throws — never a fake answer', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));

    await expect(fetchNearbyHistory(freshCenter())).rejects.toThrow('Network request failed');
  });

  test("last session's items hydrate for the detail screen", async () => {
    // getCachedHistoryItem is sync; give hydration its microtasks
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getCachedHistoryItem(7)?.title).toBe('Persisted Detail');
  });
});

describe('fetchStory', () => {
  beforeEach(() => mockFetch.mockReset());

  test('requests /api/story and populates the item cache', async () => {
    const story = { ...item, pageId: 4242, title: 'Marshalsea' };
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ item: story }) });

    const first = await fetchStory(4242);

    expect(String(mockFetch.mock.calls[0][0])).toContain('/api/story?pageId=4242');
    expect(first?.title).toBe('Marshalsea');
    // The cold-start fetch feeds the same session cache the list fills
    expect(getCachedHistoryItem(4242)?.title).toBe('Marshalsea');

    // …and a cached story never re-fetches
    const second = await fetchStory(4242);
    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('a true 404 is null — the story genuinely does not exist', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    expect(await fetchStory(4243)).toBeNull();
  });

  test('upstream trouble throws, so callers can tell it from a 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(fetchStory(4244)).rejects.toThrow('502');
  });
});
