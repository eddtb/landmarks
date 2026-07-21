import { zoomFor } from '@/app/history/[pageId]/go';

describe('zoomFor', () => {
  test('close stories get a tight camera, far ones a wide one, both clamped', () => {
    expect(zoomFor(50)).toBe(17); // touching distance: max zoom
    expect(zoomFor(150)).toBe(17); // the reference distance
    expect(zoomFor(600)).toBeCloseTo(15, 0);
    expect(zoomFor(5000)).toBe(12); // clamped wide
    expect(zoomFor(0)).toBe(17); // standing on it
  });
});
