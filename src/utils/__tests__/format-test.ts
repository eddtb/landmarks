import { formatDistance, formatRating } from '@/utils/format';

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
