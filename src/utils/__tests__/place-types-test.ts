import { Place } from '@/types/place';
import { buildTypeGroups, matchesTypeFilter, typeGroup, typeNoun } from '@/utils/place-types';

function place(primaryLabel?: string): Place {
  return {
    id: primaryLabel ?? 'x',
    name: 'Test',
    category: 'drink',
    coordinates: { latitude: 0, longitude: 0 },
    rating: 4,
    photoUrl: 'https://example.com/p.jpg',
    address: '',
    primaryLabel,
  };
}

describe('typeGroup', () => {
  test('folds cuisine labels into Restaurant', () => {
    expect(typeGroup('Chinese Restaurant')).toBe('Restaurant');
    expect(typeGroup('Fish & Chips Restaurant')).toBe('Restaurant');
  });

  test('folds bar variants into Bar', () => {
    expect(typeGroup('Cocktail Bar')).toBe('Bar');
    expect(typeGroup('Wine Bar')).toBe('Bar');
    expect(typeGroup('Bar')).toBe('Bar');
  });

  test('applies overrides where the last word lies', () => {
    expect(typeGroup('Steak House')).toBe('Restaurant');
    expect(typeGroup('Bar & Grill')).toBe('Bar');
  });

  test('groups museums case-insensitively (Google sends "Art museum")', () => {
    expect(typeGroup('Art museum')).toBe('Museum');
    expect(typeGroup('Museum')).toBe('Museum');
  });

  test('leaves compound shops alone — Coffee Shop is not Dessert Shop', () => {
    expect(typeGroup('Coffee Shop')).toBe('Coffee Shop');
    expect(typeGroup('Dessert Shop')).toBe('Dessert Shop');
    expect(typeGroup('Pub')).toBe('Pub');
  });
});

describe('buildTypeGroups', () => {
  test('counts and sorts groups and their labels, largest first', () => {
    const groups = buildTypeGroups([
      place('Pub'),
      place('Pub'),
      place('Cocktail Bar'),
      place('Bar'),
      place('Bar'),
      place(undefined),
    ]);
    expect(groups).toEqual([
      {
        group: 'Bar',
        count: 3,
        labels: [
          { label: 'Bar', count: 2 },
          { label: 'Cocktail Bar', count: 1 },
        ],
      },
      { group: 'Pub', count: 2, labels: [{ label: 'Pub', count: 2 }] },
    ]);
  });
});

describe('matchesTypeFilter', () => {
  test('all matches everything, including unlabelled places', () => {
    expect(matchesTypeFilter(place(undefined), 'all')).toBe(true);
  });

  test('group filters match every member label', () => {
    expect(matchesTypeFilter(place('Cocktail Bar'), 'group:Bar')).toBe(true);
    expect(matchesTypeFilter(place('Pub'), 'group:Bar')).toBe(false);
    expect(matchesTypeFilter(place(undefined), 'group:Bar')).toBe(false);
  });

  test('label filters match exactly one label', () => {
    expect(matchesTypeFilter(place('Cocktail Bar'), 'label:Cocktail Bar')).toBe(true);
    expect(matchesTypeFilter(place('Bar'), 'label:Cocktail Bar')).toBe(false);
  });
});

describe('typeNoun', () => {
  test('reads as the quiet lowercase sentence noun', () => {
    expect(typeNoun('all')).toBe('places');
    expect(typeNoun('group:Pub')).toBe('pubs');
    expect(typeNoun('group:Coffee Shop')).toBe('coffee shops');
    expect(typeNoun('group:Bakery')).toBe('bakeries');
    expect(typeNoun('label:Chinese Restaurant')).toBe('chinese restaurants');
  });

  test('singularizes when there is exactly one', () => {
    expect(typeNoun('group:Coffee Shop', 1)).toBe('coffee shop');
    expect(typeNoun('all', 1)).toBe('place');
    expect(typeNoun('group:Pub', 21)).toBe('pubs');
  });
});
