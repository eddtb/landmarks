import { moveItem } from '@/components/reorder-list';

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd'];

  test('moves forward and backward', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(items, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  test('no-ops on same index or out-of-range targets', () => {
    expect(moveItem(items, 1, 1)).toBe(items);
    expect(moveItem(items, 1, 9)).toBe(items);
    expect(moveItem(items, -1, 2)).toBe(items);
  });
});
