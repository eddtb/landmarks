import { addToPlan, clearPlan, getPlanItems, moveItem, movePlanItem, PlanItem } from '@/data/plan-store';

function item(id: string): PlanItem {
  return {
    id,
    name: id,
    coordinates: { latitude: 0, longitude: 0 },
    facts: [],
    dwellMinutes: 60,
  };
}

describe('moveItem', () => {
  const list = ['a', 'b', 'c', 'd'];

  test('moves forward and backward', () => {
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(list, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  test('no-ops on same index or out-of-range targets', () => {
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 1, 9)).toBe(list);
    expect(moveItem(list, -1, 2)).toBe(list);
  });
});

describe('movePlanItem (the ↑↓ buttons)', () => {
  beforeEach(() => {
    clearPlan();
    addToPlan(item('first'));
    addToPlan(item('second'));
    addToPlan(item('third'));
  });

  test('shifts one slot each way', () => {
    movePlanItem(1, -1);
    expect(getPlanItems().map((entry) => entry.id)).toEqual(['second', 'first', 'third']);
    movePlanItem(1, 1);
    expect(getPlanItems().map((entry) => entry.id)).toEqual(['second', 'third', 'first']);
  });

  test('clamps at the ends', () => {
    movePlanItem(0, -1);
    movePlanItem(2, 1);
    expect(getPlanItems().map((entry) => entry.id)).toEqual(['first', 'second', 'third']);
  });
});
