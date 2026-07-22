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
// after a force-quit. Keys are the client's own ~111m (3 dp — the
// server's own grid) buckets; values are whole feeds (items plus
// sparse metadata).
const store = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
  .__INTERNAL_MOCK_STORAGE__;
store['cache-history-feed-v1'] = JSON.stringify([
  [
    '50.100|-0.090',
    { value: { items: [persistedItem(1, 'Persisted Fresh')] }, at: Date.now() },
  ],
  [
    '50.200|-0.090',
    { value: { items: [persistedItem(2, 'Persisted Stale')] }, at: Date.now() - 2 * HourMs },
  ],
  [
    '50.300|-0.090',
    { value: { items: [persistedItem(3, 'Persisted Offline')] }, at: Date.now() - 2 * HourMs },
  ],
  [
    '50.400|-0.090',
    {
      value: { items: [persistedItem(4, 'Persisted Sparse Village')], sparse: true },
      at: Date.now() - 2 * HourMs,
    },
  ],
]);
store['cache-history-item-v1'] = JSON.stringify([
  ['7', { value: persistedItem(7, 'Persisted Detail'), at: Date.now() }],
]);

const { fetchNearbyHistory, fetchStory, getCachedHistoryItem, getStoriesAround } =
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

  test("an expired offline bucket still answers the neighbourhood ask", () => {
    // 50.3 was served offline-stale above and never revalidated — the
    // feed on screen IS that expired bucket, so a story opened from it
    // keeps its neighbourhood (peek's grade, not get's)
    expect(getStoriesAround(3).map((story) => story.title)).toEqual(['Persisted Offline']);
  });
});

// The early-serve contract (#201): a dressing:true feed is stored —
// flag included, never as final — and the upgrade re-ask reaches the
// server without fresh=1 (the dressed verdict is in its bucket cache;
// a full recompose would be waste).
describe('fetchNearbyHistory dressing upgrade', () => {
  beforeEach(() => mockFetch.mockReset());

  test('a dressing feed persists WITH its flag — honest offline material, never a quiet final', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item], dressing: true }) });
    const center = freshCenter();

    const first = await fetchNearbyHistory(center);
    expect(first.dressing).toBe(true);

    // The cached read-back still carries the flag — that is what lets
    // useHistory see it after a relaunch and fire the one-shot upgrade
    const second = await fetchNearbyHistory(center);
    expect(second).toBe(first);
    expect(second.dressing).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('upgrade skips the client cache but never sends fresh=1 — and the dressed feed replaces the flagged one', async () => {
    const center = freshCenter();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [item], dressing: true }),
    });
    await fetchNearbyHistory(center);

    const dressedItem = { ...item, thumbnailUrl: 'https://img/1.jpg' };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ items: [dressedItem] }) });
    const upgraded = await fetchNearbyHistory(center, { upgrade: true });

    expect(mockFetch).toHaveBeenCalledTimes(2); // the cache did not swallow the upgrade
    expect(String(mockFetch.mock.calls[1][0])).not.toContain('fresh=1');
    expect(upgraded.dressing).toBeUndefined();
    expect(upgraded.items[0].thumbnailUrl).toBe('https://img/1.jpg');

    // The dressed verdict is now the bucket's answer
    const after = await fetchNearbyHistory(center);
    expect(after).toBe(upgraded);
    expect(mockFetch).toHaveBeenCalledTimes(2);
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

// These mint fresh feed buckets, and the feed cache caps at 8 — they
// run LAST so any eviction lands after the persistence assertions above.
describe('fetchNearbyHistory bucket grain (the walking-tick fix)', () => {
  beforeEach(() => mockFetch.mockReset());

  test("4th-decimal GPS jitter lands in one 3 dp bucket — one fetch, the server's own grain", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });
    const base = freshCenter();

    await fetchNearbyHistory(base);
    // ~30m of drift: below the ~111m bucket, previously a fresh ~124KB
    // fetch (4 dp buckets were ~11m — finer than the ~10m GPS tick)
    await fetchNearbyHistory({
      latitude: base.latitude + 0.0004,
      longitude: base.longitude + 0.0003,
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('a repeated bucket hit returns the identical result object', async () => {
    // The reference useHistory's setState bail hangs on: same bucket,
    // same object — not a fresh spread per tick
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });
    const center = freshCenter();

    const first = await fetchNearbyHistory(center);
    const second = await fetchNearbyHistory(center);

    expect(second).toBe(first);
  });
});

// Both tabs stay mounted and each runs useHistory — entering a fresh
// bucket is always TWO concurrent cache misses. (Same cap note as
// above: these mint buckets, so they run after the persistence tests.)
describe('fetchNearbyHistory in-flight dedupe', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => mockFetch.mockReset());

  test('concurrent callers for one fresh bucket share one network ask — and its result object', async () => {
    let resolveFetch!: (response: unknown) => void;
    mockFetch.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    const center = freshCenter();

    const one = fetchNearbyHistory(center);
    const two = fetchNearbyHistory(center); // the other tab, same tick
    await tick();
    resolveFetch({ ok: true, json: async () => ({ items: [item] }) });

    const [first, second] = await Promise.all([one, two]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test('a failed in-flight ask never poisons the bucket — the next caller retries', async () => {
    const center = freshCenter();
    mockFetch.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(fetchNearbyHistory(center)).rejects.toThrow('Network request failed');

    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });
    const retried = await fetchNearbyHistory(center);

    expect(retried.items).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2); // the retry really fetched
  });

  test('forceRefresh cuts past an in-flight plain ask; a later plain caller rides the refresh', async () => {
    let resolvePlain!: (response: unknown) => void;
    let resolveForced!: (response: unknown) => void;
    mockFetch
      .mockReturnValueOnce(new Promise((resolve) => (resolvePlain = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveForced = resolve)));
    const center = freshCenter();

    const plain = fetchNearbyHistory(center);
    await tick(); // let the plain ask register in-flight first
    const forced = fetchNearbyHistory(center, { forceRefresh: true }); // starts its own
    const rider = fetchNearbyHistory(center); // plain, arrives after — shares the refresh
    await tick();
    expect(mockFetch).toHaveBeenCalledTimes(2); // plain + forced, never a third

    resolvePlain({ ok: true, json: async () => ({ items: [item] }) });
    resolveForced({ ok: true, json: async () => ({ items: [persistedItem(99, 'Fresher')] }) });

    expect((await plain).items[0].pageId).toBe(42);
    expect((await forced).items[0].pageId).toBe(99); // the pull reached the network
    expect(await rider).toBe(await forced); // and served the concurrent plain caller
  });
});

// getStoriesAround: the detail screen's neighbourhood ask (#202) —
// the web of history links a story to the stories around it, not to
// the whole persisted item store. (These mint buckets, so they run
// last with the other minters — same cap note as above.)
describe('getStoriesAround', () => {
  beforeEach(() => mockFetch.mockReset());

  test('answers with the containing feed — as the IDENTICAL stored array', async () => {
    const neighbours = [
      persistedItem(500, 'Thames Tunnel'),
      persistedItem(501, 'Brunel Engine House'),
    ];
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ items: neighbours }) });
    const feed = await fetchNearbyHistory(freshCenter());

    // Reference equality is the contract render-time memoization hangs on
    expect(getStoriesAround(500)).toBe(feed.items);
    expect(getStoriesAround(501)).toBe(feed.items);
  });

  test("a story in no cached feed gets the shared empty neighbourhood — never another town's stories", () => {
    expect(getStoriesAround(987654)).toHaveLength(0);
    // One stable [] for every stranger — identity again, not a fresh array
    expect(getStoriesAround(987654)).toBe(getStoriesAround(123456));
  });

  test('a story in two overlapping buckets answers from the newest-minted one', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [persistedItem(600, 'Shared Story'), persistedItem(601, 'Old Neighbour')],
      }),
    });
    await fetchNearbyHistory(freshCenter());
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [persistedItem(600, 'Shared Story'), persistedItem(602, 'New Neighbour')],
      }),
    });
    await fetchNearbyHistory(freshCenter());

    const titles = getStoriesAround(600).map((story) => story.title);
    expect(titles).toContain('New Neighbour');
    expect(titles).not.toContain('Old Neighbour');
  });
});
