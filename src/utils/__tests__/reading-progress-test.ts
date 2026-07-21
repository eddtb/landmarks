import { readingProgress } from '@/utils/reading-progress';

describe('readingProgress', () => {
  test('halfway through the scrollable range is 0.5', () => {
    expect(readingProgress(500, 1800, 800)).toBe(0.5);
  });

  test('clamps: overscroll bounce cannot escape 0..1', () => {
    expect(readingProgress(-40, 1800, 800)).toBe(0);
    expect(readingProgress(1200, 1800, 800)).toBe(1);
  });

  test('content that fits on screen reports 0 — nothing to track', () => {
    expect(readingProgress(0, 600, 800)).toBe(0);
    expect(readingProgress(0, 800, 800)).toBe(0);
  });
});
