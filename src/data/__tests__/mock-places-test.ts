import { MockPlaces, placeById, placesByCategory } from '@/data/mock-places';

// Borough Market — central to the mock data set
const UserLocation = { latitude: 51.5055, longitude: -0.0906 };

describe('placesByCategory', () => {
  test('every section has places to show', () => {
    expect(placesByCategory('landmark', UserLocation).length).toBeGreaterThan(0);
    expect(placesByCategory('restaurant', UserLocation).length).toBeGreaterThan(0);
    expect(placesByCategory('pub', UserLocation).length).toBeGreaterThan(0);
  });

  test('returns only places of the requested category', () => {
    for (const place of placesByCategory('pub', UserLocation)) {
      expect(place.category).toBe('pub');
    }
  });

  test('computes a distance for every place', () => {
    for (const place of placesByCategory('landmark', UserLocation)) {
      expect(place.distanceMeters).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(place.distanceMeters)).toBe(true);
    }
  });

  test('sorts nearest first', () => {
    const distances = placesByCategory('landmark', UserLocation).map(
      (place) => place.distanceMeters
    );
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
  });

  test('distance depends on where the user is', () => {
    const nearTowerBridge = { latitude: 51.5055, longitude: -0.0754 };
    const nearest = placesByCategory('landmark', nearTowerBridge)[0];
    expect(nearest.id).toBe('tower-bridge');
  });
});

describe('placeById', () => {
  test('finds a place by id', () => {
    expect(placeById('tower-bridge')?.name).toBe('Tower Bridge');
  });

  test('returns undefined for unknown ids', () => {
    expect(placeById('narnia')).toBeUndefined();
  });

  test('ids are unique', () => {
    const ids = MockPlaces.map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
