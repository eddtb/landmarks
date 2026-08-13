/**
 * The pointing question's arithmetic. Worth testing hard precisely
 * because it cannot be checked on a simulator — there is no magnetometer
 * there, so this file is the only place the maths is ever verified
 * before it reaches a phone.
 */
import { HistoryItem } from '@/types/history';
import {
  DirectionToleranceDegrees,
  MinPointableMeters,
  headingError,
  pointableStory,
  pointedCorrectly,
} from '@/utils/quiz-direction';

const greenwich = { latitude: 51.4826, longitude: -0.0077 };

/** metresNorth/metresEast from Greenwich, roughly. */
const place = (pageId: number, title: string, metresNorth: number, metresEast = 0): HistoryItem => ({
  pageId,
  title,
  coordinates: {
    latitude: greenwich.latitude + metresNorth / 111_000,
    longitude: greenwich.longitude + metresEast / (111_000 * Math.cos((51.4826 * Math.PI) / 180)),
  },
  distanceMeters: 0, // deliberately wrong: the feed's value must not be trusted
  url: 'https://en.wikipedia.org/wiki/X',
  source: 'Wikipedia',
});

describe('headingError', () => {
  test('facing it exactly is no error at all', () => {
    expect(headingError(90, 90)).toBe(0);
  });

  test('wraps the short way round — 350 against 10 is 20 out, not 340', () => {
    expect(headingError(350, 10)).toBe(20);
    expect(headingError(10, 350)).toBe(20);
  });

  test('never exceeds 180, whichever way you are turned', () => {
    expect(headingError(0, 180)).toBe(180);
    expect(headingError(0, 181)).toBe(179);
    expect(headingError(270, 90)).toBe(180);
  });

  test('handles headings past a full turn', () => {
    expect(headingError(370, 10)).toBe(0);
    expect(headingError(-10, 350)).toBe(0);
  });
});

describe('pointedCorrectly', () => {
  test('inside the tolerance counts, outside does not', () => {
    expect(DirectionToleranceDegrees).toBe(30);
    expect(pointedCorrectly(100, 90)).toBe(true);
    expect(pointedCorrectly(120, 90)).toBe(true); // exactly on the line
    expect(pointedCorrectly(121, 90)).toBe(false);
  });

  test('the tolerance wraps too — north is not a blind spot', () => {
    expect(pointedCorrectly(355, 5)).toBe(true);
    expect(pointedCorrectly(330, 5)).toBe(false);
  });
});

describe('pointableStory', () => {
  test('picks the nearest place far enough away to be worth pointing at', () => {
    const items = [
      place(1, 'On top of you', 20),
      place(2, 'Worth pointing at', 400),
      place(3, 'Further still', 900),
    ];

    const question = pointableStory(items, greenwich);

    expect(question?.pageId).toBe(2);
    expect(question?.title).toBe('Worth pointing at');
    // Due north
    expect(question?.bearing).toBeCloseTo(0, 0);
    expect(question?.distanceMeters).toBeGreaterThan(350);
    expect(question?.distanceMeters).toBeLessThan(450);
  });

  test('recomputes distance from the live fix, never the feed value', () => {
    // Every fixture carries distanceMeters: 0, which would have made the
    // nearest-above-floor choice impossible if it were trusted
    const question = pointableStory([place(1, 'North', 500)], greenwich);

    expect(question?.distanceMeters).toBeGreaterThan(400);
  });

  test('bearings come out in the right quadrant', () => {
    const east = pointableStory([place(1, 'East', 0, 500)], greenwich);
    const south = pointableStory([place(2, 'South', -500)], greenwich);

    expect(east?.bearing).toBeCloseTo(90, 0);
    expect(south?.bearing).toBeCloseTo(180, 0);
  });

  test('nothing far enough away, no question — pointing at your own feet is not one', () => {
    expect(MinPointableMeters).toBe(100);
    const tooClose = [place(1, 'Here', 10), place(2, 'Also here', 60)];

    expect(pointableStory(tooClose, greenwich)).toBeNull();
  });

  test('an empty feed yields nothing rather than throwing', () => {
    expect(pointableStory([], greenwich)).toBeNull();
  });
});
