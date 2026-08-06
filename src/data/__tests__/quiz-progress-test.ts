/**
 * The ground's memory of the quizzer: cumulative, per-area, add-only.
 * The rank ladder is the reason to run the same ground twice — so the
 * tally must survive runs, ignore case, and never move backwards.
 */
import {
  Ranks,
  areaProgress,
  rankFor,
  recordRun,
  setQuizProgressForTests,
} from '@/data/quiz-progress';

beforeEach(() => {
  setQuizProgressForTests({});
});

describe('rankFor', () => {
  test('the ladder climbs and never skips', () => {
    expect(rankFor(0)).toBe('Stranger');
    expect(rankFor(4)).toBe('Stranger');
    expect(rankFor(5)).toBe('Visitor');
    expect(rankFor(14)).toBe('Visitor');
    expect(rankFor(15)).toBe('Local');
    expect(rankFor(29)).toBe('Local');
    expect(rankFor(30)).toBe('Historian');
    expect(rankFor(1000)).toBe('Historian');
  });

  test('one clean six-question run makes Visitor — the first climb is one run away', () => {
    expect(rankFor(6)).toBe('Visitor');
  });

  test('the ladder is the exported one, in climbing order', () => {
    expect(Ranks).toEqual(['Stranger', 'Visitor', 'Local', 'Historian']);
  });
});

describe('recordRun', () => {
  test('tallies runs cumulatively — the rank is for learning the place', () => {
    recordRun('Greenwich', 4, 6);
    recordRun('Greenwich', 5, 6);

    expect(areaProgress('Greenwich')).toEqual({
      correct: 9,
      runs: 2,
      best: { correct: 5, total: 6 },
    });
  });

  test('best keeps the best RATE, not the biggest number', () => {
    recordRun('Greenwich', 3, 3);
    recordRun('Greenwich', 4, 6);

    expect(areaProgress('Greenwich')?.best).toEqual({ correct: 3, total: 3 });
  });

  test('"Greenwich" and "greenwich" are one ground', () => {
    recordRun('Greenwich', 2, 6);
    recordRun('greenwich', 3, 6);

    expect(areaProgress('GREENWICH')?.correct).toBe(5);
  });

  test('areas do not leak into each other', () => {
    recordRun('Greenwich', 6, 6);

    expect(areaProgress('Deptford')).toBeUndefined();
  });

  test('a zero-question run records nothing', () => {
    recordRun('Greenwich', 0, 0);
    recordRun('  ', 3, 6);

    expect(areaProgress('Greenwich')).toBeUndefined();
  });
});
