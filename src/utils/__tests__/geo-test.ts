import { standingOn } from '@/components/section-screen';
import { bearingDegrees, compassPoint, compassWords, distanceMeters } from '@/utils/geo';

const TowerBridge = { latitude: 51.5055, longitude: -0.0754 };
const StPauls = { latitude: 51.5138, longitude: -0.0984 };

describe('distanceMeters', () => {
  test('distance to the same point is zero', () => {
    expect(distanceMeters(TowerBridge, TowerBridge)).toBe(0);
  });

  test('is symmetric', () => {
    expect(distanceMeters(TowerBridge, StPauls)).toBeCloseTo(
      distanceMeters(StPauls, TowerBridge),
      6
    );
  });

  test('Tower Bridge to St Pauls is roughly 1.8 km', () => {
    const distance = distanceMeters(TowerBridge, StPauls);
    expect(distance).toBeGreaterThan(1600);
    expect(distance).toBeLessThan(2100);
  });
});

describe('bearingDegrees', () => {
  const origin = { latitude: 51.5, longitude: -0.09 };

  test('cardinal directions', () => {
    expect(bearingDegrees(origin, { latitude: 51.51, longitude: -0.09 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(origin, { latitude: 51.5, longitude: -0.08 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(origin, { latitude: 51.49, longitude: -0.09 })).toBeCloseTo(180, 0);
    expect(bearingDegrees(origin, { latitude: 51.5, longitude: -0.1 })).toBeCloseTo(270, 0);
  });
});

/**
 * `arrowTowards` had four green tests here and no caller anywhere. It
 * was written for the card arrows of #28, which #29 removed a day
 * later, and it returned `↑ → ← ↖` — the bare glyphs PR #186 then
 * banned outright ("a tappable label is a word VoiceOver can say").
 * Four tests were asserting that dead code still computed retired
 * marks correctly; nothing they could have caught would have reached a
 * reader. The function and its tests are deleted together.
 *
 * What DID replace it is the compass point on the dial — the same
 * eight-way rounding, going to a reader instead of nowhere.
 */
describe('compassPoint (the dial’s “away · NE”)', () => {
  test('the eight points, rounded to the nearest', () => {
    expect(compassPoint(0)).toBe('N');
    expect(compassPoint(45)).toBe('NE');
    expect(compassPoint(90)).toBe('E');
    expect(compassPoint(180)).toBe('S');
    expect(compassPoint(270)).toBe('W');
    // The boundary is 22.5°, and it wraps
    expect(compassPoint(20)).toBe('N');
    expect(compassPoint(30)).toBe('NE');
    expect(compassPoint(359)).toBe('N');
    expect(compassPoint(-45)).toBe('NW');
  });

  test('the dial abbreviates and the prose does not — they never disagree', () => {
    // Two renderings of one bearing: the card's letters and the
    // sentence VoiceOver reads. A drift between them is a compass
    // pointing one way and saying another.
    const spoken: Record<string, string> = {
      N: 'north',
      NE: 'north-east',
      E: 'east',
      SE: 'south-east',
      S: 'south',
      SW: 'south-west',
      W: 'west',
      NW: 'north-west',
    };
    for (let bearing = 0; bearing < 360; bearing += 7) {
      expect(spoken[compassPoint(bearing)]).toBe(compassWords(bearing));
    }
  });
});

describe('standingOn (imported from section-screen)', () => {
  // Placed here to keep the pure helper honest without a component test
  const story = (pageId: number, latitude: number) => ({
    pageId, title: 'S', coordinates: { latitude, longitude: 0 },
    distanceMeters: 9999, url: 'https://x', source: 'Wikipedia',
  });
  test('the nearest story within reach wins; beyond reach, nothing', () => {
    const here = { latitude: 51.4, longitude: 0 };
    const near = story(1, 51.4002);   // ~22m
    const nearer = story(2, 51.4001); // ~11m
    const far = story(3, 51.41);      // ~1.1km
    expect(standingOn([near, far, nearer], here)?.pageId).toBe(2);
    expect(standingOn([far], here)).toBeNull();
    // compose-time distanceMeters (9999) is ignored: live position rules
  });
});

describe('compassWords', () => {
  test('speaks the bearing instead of abbreviating it', () => {
    // "NE" is right on a dial and wrong in a sentence — and VoiceOver
    // reads the abbreviation as the letter N
    expect(compassWords(0)).toBe('north');
    expect(compassWords(45)).toBe('north-east');
    expect(compassWords(90)).toBe('east');
    expect(compassWords(180)).toBe('south');
    expect(compassWords(270)).toBe('west');
    expect(compassWords(315)).toBe('north-west');
  });

  test('rounds to the nearest of the eight, and wraps', () => {
    expect(compassWords(30)).toBe('north-east'); // the boundary is 22.5°
    expect(compassWords(20)).toBe('north');
    expect(compassWords(359)).toBe('north');
    expect(compassWords(361)).toBe('north');
    expect(compassWords(-45)).toBe('north-west');
  });
});
