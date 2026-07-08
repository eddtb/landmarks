import { cachePlaces, fetchNearbyPlaces, getCachedPlace } from '@/data/places-client';
import { MockPlaces } from '@/data/mock-places';

const mockFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

// Distinct centers per test so the module-level list cache cannot leak
// results between tests.
let latSeed = 51.5;
function freshCenter() {
  latSeed += 0.01;
  return { latitude: latSeed, longitude: -0.09 };
}

describe('fetchNearbyPlaces', () => {
  beforeEach(() => mockFetch.mockReset());

  test('requests our API route with the right params', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    const center = freshCenter();

    await fetchNearbyPlaces('pub', center);

    const requested = mockFetch.mock.calls[0][0] as string;
    expect(requested).toContain('/api/places?');
    expect(requested).toContain(`lat=${center.latitude}`);
    expect(requested).toContain('lng=-0.09');
    expect(requested).toContain('category=pub');
  });

  test('returns the places from the response and caches them by id', async () => {
    const place = { ...MockPlaces[0], distanceMeters: 42 };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [place] }) });

    const places = await fetchNearbyPlaces('landmark', freshCenter());

    expect(places).toHaveLength(1);
    expect(getCachedPlace(place.id)?.name).toBe(place.name);
  });

  test('repeat calls for the same section hit the cache, not the network', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    const center = freshCenter();

    await fetchNearbyPlaces('pub', center);
    await fetchNearbyPlaces('pub', center);
    await fetchNearbyPlaces('pub', center);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('different categories are cached independently', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    const center = freshCenter();

    await fetchNearbyPlaces('pub', center);
    await fetchNearbyPlaces('landmark', center);
    await fetchNearbyPlaces('pub', center);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('forceRefresh bypasses the cache and updates it', async () => {
    const center = freshCenter();
    const place = { ...MockPlaces[0], distanceMeters: 42 };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [] }) });
    await fetchNearbyPlaces('pub', center);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [place] }) });
    const refreshed = await fetchNearbyPlaces('pub', center, { forceRefresh: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(refreshed).toHaveLength(1);
    // The cache now holds the refreshed list
    const again = await fetchNearbyPlaces('pub', center);
    expect(again).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('failed responses are not cached', async () => {
    const center = freshCenter();
    mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });

    await expect(fetchNearbyPlaces('landmark', center)).rejects.toThrow('502');

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [] }) });
    await fetchNearbyPlaces('landmark', center);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

describe('place cache', () => {
  test('cachePlaces seeds places for the detail screen', () => {
    cachePlaces([MockPlaces[1]]);
    expect(getCachedPlace(MockPlaces[1].id)?.name).toBe(MockPlaces[1].name);
  });

  test('unknown ids are undefined', () => {
    expect(getCachedPlace('never-cached')).toBeUndefined();
  });
});
