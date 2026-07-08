import { MockPlaces, placeById, placesByCategory } from '@/data/mock-places';

describe('placesByCategory', () => {
  test('every section has places to show', () => {
    expect(placesByCategory('landmark').length).toBeGreaterThan(0);
    expect(placesByCategory('restaurant').length).toBeGreaterThan(0);
    expect(placesByCategory('pub').length).toBeGreaterThan(0);
  });

  test('returns only places of the requested category', () => {
    for (const place of placesByCategory('pub')) {
      expect(place.category).toBe('pub');
    }
  });

  test('sorts nearest first', () => {
    const distances = placesByCategory('landmark').map((place) => place.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
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
