import { formatDistance, formatRating, formatRatingCount, formatWalkTime } from '@/utils/format';

describe('formatDistance', () => {
  test('shows meters below 1 km', () => {
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  test('shows kilometers with one decimal from 1 km', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1240)).toBe('1.2 km');
  });
});

describe('formatRating', () => {
  test('always shows one decimal', () => {
    expect(formatRating(4.5)).toBe('★ 4.5');
    expect(formatRating(4)).toBe('★ 4.0');
  });
});

describe('formatRatingCount', () => {
  test('plain numbers below a thousand', () => {
    expect(formatRatingCount(7)).toBe('7');
    expect(formatRatingCount(847)).toBe('847');
  });

  test('compact thousands, trimming trailing .0', () => {
    expect(formatRatingCount(1000)).toBe('1k');
    expect(formatRatingCount(2310)).toBe('2.3k');
    expect(formatRatingCount(68411)).toBe('68.4k');
  });
});

describe('formatWalkTime', () => {
  test('rounds to minutes with a 1-minute floor', () => {
    expect(formatWalkTime(20)).toBe('1 min walk');
    expect(formatWalkTime(73)).toBe('1 min walk');
    expect(formatWalkTime(260)).toBe('4 min walk');
    expect(formatWalkTime(900)).toBe('15 min walk');
  });
});
