import { openThroughWindow, rebaseTimes, slotTemplate, solvePlan } from '@/server/plan';
import { HistoryItem } from '@/types/history';
import { PlaceWithDistance } from '@/types/place';

const Origin = { latitude: 51.4826, longitude: -0.0077 };

/** A Tuesday 6:15pm — evening plans start here. */
const EveningStart = new Date('2026-07-21T18:15:00');

function place(overrides: Partial<PlaceWithDistance> & { id: string }): PlaceWithDistance {
  return {
    name: overrides.id,
    category: 'drink',
    coordinates: { latitude: 51.483, longitude: -0.008 },
    rating: 4.5,
    ratingCount: 500,
    photoUrl: `https://example.com/${overrides.id}.jpg`,
    address: '',
    openNow: true,
    distanceMeters: 300,
    ...overrides,
  };
}

const pools = {
  landmark: [
    place({ id: 'naval-college', category: 'landmark', primaryLabel: 'Historical Landmark', openNow: undefined }),
    place({ id: 'the-park', category: 'landmark', primaryLabel: 'Park', openNow: undefined, rating: 4.7 }),
  ],
  food: [
    place({ id: 'little-yak', category: 'food', primaryLabel: 'Restaurant', rating: 4.9, nextCloseTime: '2026-07-21T22:00:00' }),
    place({ id: 'marcella', category: 'food', primaryLabel: 'Italian Restaurant', rating: 4.6 }),
    place({ id: 'blackbird', category: 'food', primaryLabel: 'Coffee Shop', rating: 4.8 }),
    place({ id: 'sweet-spot', category: 'food', primaryLabel: 'Dessert Shop', rating: 4.4 }),
  ],
  drink: [
    place({ id: 'old-brewery', category: 'drink', primaryLabel: 'Pub', rating: 4.4 }),
    place({ id: 'tavern', category: 'drink', primaryLabel: 'Pub', rating: 4.5 }),
    place({ id: 'coffee-cart', category: 'drink', primaryLabel: 'Coffee Shop', rating: 4.9 }),
  ],
  activity: [place({ id: 'bowling', category: 'activity', primaryLabel: 'Bowling Alley', rating: 4.2 })],
};

describe('slotTemplate', () => {
  test('an evening is landmark, meal, drink', () => {
    expect(slotTemplate('evening', 'date', EveningStart).map((slot) => slot.kind)).toEqual([
      'landmark',
      'meal',
      'drink',
    ]);
  });

  test('family plans swap the closing drink for an activity', () => {
    expect(slotTemplate('evening', 'family', EveningStart).map((slot) => slot.kind)).toEqual([
      'landmark',
      'meal',
      'activity',
    ]);
  });

  test('an hour adapts to the clock', () => {
    expect(slotTemplate('hour', 'solo', new Date('2026-07-21T09:00:00'))[0].kind).toBe('coffee');
    expect(slotTemplate('hour', 'solo', new Date('2026-07-21T14:00:00'))[0].kind).toBe('landmark');
    // A solo evening hour is the walk, not the pair activity
    expect(slotTemplate('hour', 'solo', EveningStart)[0].kind).toBe('landmark');
    expect(slotTemplate('hour', 'friends', EveningStart)[0].kind).toBe('drink');
  });
});

describe('openThroughWindow', () => {
  const arrive = new Date('2026-07-21T19:00:00');
  const depart = new Date('2026-07-21T20:30:00');

  test('rejects places closing mid-window', () => {
    const closesEarly = place({ id: 'x', nextCloseTime: '2026-07-21T19:30:00' });
    expect(openThroughWindow(closesEarly, 'meal', arrive, depart)).toBe(false);
  });

  test('unknown hours pass for landmarks, fail for tills', () => {
    const silent = place({ id: 'x', openNow: undefined });
    expect(openThroughWindow(silent, 'landmark', arrive, depart)).toBe(true);
    expect(openThroughWindow(silent, 'meal', arrive, depart)).toBe(false);
  });

  test('closed places pass only when they reopen before arrival', () => {
    const reopens = place({ id: 'x', openNow: false, nextOpenTime: '2026-07-21T18:30:00' });
    const staysShut = place({ id: 'x', openNow: false, nextOpenTime: '2026-07-21T21:00:00' });
    expect(openThroughWindow(reopens, 'drink', arrive, depart)).toBe(true);
    expect(openThroughWindow(staysShut, 'drink', arrive, depart)).toBe(false);
  });
});

describe('solvePlan', () => {
  test('composes an evening: landmark, dinner, pub — with alternates', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'date',
      origin: Origin,
      pools,
      stories: [],
      rng: () => 0,
    });
    expect(solved).not.toBeNull();
    const kinds = solved!.stops.map((stop) => stop.slotKind);
    expect(kinds).toEqual(['landmark', 'meal', 'drink']);
    // The meal slot never offers coffee shops; the drink slot never does either
    expect(solved!.stops[1].primaryLabel).toMatch(/Restaurant/);
    expect(solved!.stops[2].primaryLabel).toBe('Pub');
    // Understudies ride along, fitted to the same slot
    expect(solved!.stops[1].alternates.length).toBeGreaterThan(0);
    expect(solved!.stops[1].alternates[0].placeId).not.toBe(solved!.stops[1].placeId);
    // Times flow forward
    expect(new Date(solved!.stops[2].arrive).getTime()).toBeGreaterThan(
      new Date(solved!.stops[0].depart).getTime()
    );
  });

  test('family evenings end sweet or playful, never at the pub', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'family',
      origin: Origin,
      pools,
      stories: [],
      rng: () => 0,
    });
    expect(solved!.stops.map((stop) => stop.slotKind)).not.toContain('drink');
  });

  test('rain moves the landmark slot indoors', () => {
    const dry = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'solo',
      origin: Origin,
      pools,
      stories: [],
      rainy: false,
      rng: () => 0,
    });
    const wet = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'solo',
      origin: Origin,
      pools,
      stories: [],
      rainy: true,
      rng: () => 0,
    });
    expect(dry!.stops[0].placeId).toBe('the-park');
    expect(wet!.stops[0].placeId).toBe('naval-college');
  });

  test('a story near the walking line rides its leg', () => {
    const stories: HistoryItem[] = [
      {
        pageId: 7,
        title: 'Palace of Placentia',
        coordinates: { latitude: 51.4828, longitude: -0.00785 },
        distanceMeters: 60,
        extract: 'Henry VIII was born here. It vanished in the 1690s.',
        url: 'https://en.wikipedia.org/wiki/Palace_of_Placentia',
      },
    ];
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'date',
      origin: Origin,
      pools,
      stories,
      rng: () => 0,
    });
    const storied = solved!.legs.find((leg) => leg.story);
    expect(storied?.story?.title).toBe('Palace of Placentia');
    expect(storied?.story?.hook).toBe('Henry VIII was born here.');
  });

  test('a thin neighbourhood yields a shorter plan, never padding', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'date',
      origin: Origin,
      pools: { ...pools, food: [] },
      stories: [],
      rng: () => 0,
    });
    expect(solved!.stops.map((stop) => stop.slotKind)).toEqual(['landmark', 'drink']);
    expect(solved!.unfilledSlots).toEqual(['meal']);
  });
});

describe('occasion character (the anti-Cutty-Sark rules)', () => {
  const magnetVsPark = {
    ...pools,
    landmark: [
      place({
        id: 'tourist-magnet',
        category: 'landmark',
        primaryLabel: 'Tourist Attraction',
        rating: 4.6,
        ratingCount: 12000,
        openNow: undefined,
      }),
      place({
        id: 'quiet-park',
        category: 'landmark',
        primaryLabel: 'Park',
        rating: 4.7,
        ratingCount: 800,
        openNow: undefined,
      }),
    ],
  };

  test('solo prefers the park walk over the 12k-review magnet', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'solo',
      origin: Origin,
      pools: magnetVsPark,
      stories: [],
      rng: () => 0,
    });
    expect(solved!.stops[0].placeId).toBe('quiet-park');
  });

  test('a friends evening does something before the pub', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'friends',
      origin: Origin,
      pools,
      stories: [],
      rng: () => 0,
    });
    expect(solved!.stops.map((stop) => stop.slotKind)).toEqual(['activity', 'meal', 'drink']);
  });

  test('the deal varies: different rolls compose different plans', () => {
    const first = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'solo',
      origin: Origin,
      pools: magnetVsPark,
      stories: [],
      rng: () => 0,
    });
    const second = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'solo',
      origin: Origin,
      pools: magnetVsPark,
      stories: [],
      rng: () => 0.97,
    });
    expect(first!.stops[0].placeId).not.toBe(second!.stops[0].placeId);
  });
});

describe('rebaseTimes', () => {
  test('re-flows times from real legs and validates windows in code', () => {
    const solved = solvePlan({
      start: EveningStart,
      duration: 'evening',
      company: 'date',
      origin: Origin,
      pools,
      stories: [],
      rng: () => 0,
    })!;
    const relaxed = rebaseTimes(solved, EveningStart, solved.legs.map(() => 300));
    expect(relaxed.valid).toBe(true);
    expect(new Date(solved.stops[0].arrive).getTime()).toBe(EveningStart.getTime() + 300000);

    // A brutal first leg pushes dinner past the kitchen — invalid, caught here
    const brutal = rebaseTimes(solved, EveningStart, solved.legs.map(() => 3 * 60 * 60));
    expect(brutal.valid).toBe(false);
  });
});
