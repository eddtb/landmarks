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

const Center = { latitude: 51.5, longitude: -0.09 };

describe('fetchNearbyPlaces', () => {
  beforeEach(() => mockFetch.mockReset());

  test('requests our API route with the right params', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [] }) });

    await fetchNearbyPlaces('pub', Center);

    const requested = mockFetch.mock.calls[0][0] as string;
    expect(requested).toContain('/api/places?');
    expect(requested).toContain('lat=51.5');
    expect(requested).toContain('lng=-0.09');
    expect(requested).toContain('category=pub');
  });

  test('returns the places from the response and caches them by id', async () => {
    const place = { ...MockPlaces[0], distanceMeters: 42 };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ places: [place] }) });

    const places = await fetchNearbyPlaces('landmark', Center);

    expect(places).toHaveLength(1);
    expect(getCachedPlace(place.id)?.name).toBe(place.name);
  });

  test('throws on a failed response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    await expect(fetchNearbyPlaces('landmark', Center)).rejects.toThrow('502');
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
