import { fetchNearbyHistory, getCachedHistoryItem } from '@/data/history-client';

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
    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getCachedHistoryItem(42)?.title).toBe('Borough Compter');
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
