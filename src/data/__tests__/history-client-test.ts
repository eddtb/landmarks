import { fetchNearbyHistory, fetchStory, getCachedHistoryItem } from '@/data/history-client';

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
};

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
  });

  test('throws on failed responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(fetchNearbyHistory(freshCenter())).rejects.toThrow('502');
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
