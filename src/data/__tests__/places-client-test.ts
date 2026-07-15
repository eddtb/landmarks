import {
  cachePlaces,
  fetchNearbyPlaces,
  fetchPlaceDetails,
  getCachedPlace,
} from '@/data/places-client';
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

    await fetchNearbyPlaces('drink', center);

    const requested = mockFetch.mock.calls[0][0] as string;
    expect(requested).toContain('/api/places?');
    expect(requested).toContain(`lat=${center.latitude}`);
    expect(requested).toContain('lng=-0.09');
    expect(requested).toContain('category=drink');
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

    await fetchNearbyPlaces('drink', center);
    await fetchNearbyPlaces('drink', center);
    await fetchNearbyPlaces('drink', center);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('different categories are cached independently', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });
    const center = freshCenter();

    await fetchNearbyPlaces('drink', center);
    await fetchNearbyPlaces('landmark', center);
    await fetchNearbyPlaces('drink', center);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('forceRefresh bypasses the cache and updates it', async () => {
    const center = freshCenter();
    const place = { ...MockPlaces[0], distanceMeters: 42 };
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [] }) });
    await fetchNearbyPlaces('drink', center);

    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ places: [place] }) });
    const refreshed = await fetchNearbyPlaces('drink', center, { forceRefresh: true });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(refreshed).toHaveLength(1);
    // The cache now holds the refreshed list
    const again = await fetchNearbyPlaces('drink', center);
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

describe('fetchPlaceDetails', () => {
  beforeEach(() => mockFetch.mockReset());

  const details = { ...MockPlaces[0], photoUrls: [MockPlaces[0].photoUrl], phone: '020 1234 5678' };

  test('fetches /api/place/:id and caches per place', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ place: details }) });

    const first = await fetchPlaceDetails('details-cache-test');
    const second = await fetchPlaceDetails('details-cache-test');

    expect(mockFetch.mock.calls[0][0]).toContain('/api/place/details-cache-test');
    expect(first?.phone).toBe('020 1234 5678');
    expect(second).toEqual(first);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('resolves null on 404 (unknown place)', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    expect(await fetchPlaceDetails('narnia-details')).toBeNull();
  });

  test('throws on server errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(fetchPlaceDetails('boom-details')).rejects.toThrow('502');
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
