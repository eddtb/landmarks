import { formatDistance, formatRating, formatWalkTime } from '@/utils/format';

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

describe('formatWalkTime', () => {
  test('rounds to minutes with a 1-minute floor', () => {
    expect(formatWalkTime(20)).toBe('1 min walk');
    expect(formatWalkTime(73)).toBe('1 min walk');
    expect(formatWalkTime(260)).toBe('4 min walk');
    expect(formatWalkTime(900)).toBe('15 min walk');
  });
});
