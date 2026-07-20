import {
  addToWalk,
  clearWalk,
  getWalkStops,
  moveItem,
  moveWalkStop,
  WalkStop,
  walkStopFromStory,
} from '@/data/plan-store';

function stop(pageId: number): WalkStop {
  return {
    pageId,
    title: `Story ${pageId}`,
    coordinates: { latitude: 0, longitude: 0 },
    source: 'Wikipedia',
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

describe('the walk store', () => {
  beforeEach(() => {
    clearWalk();
    addToWalk(stop(1));
    addToWalk(stop(2));
    addToWalk(stop(3));
  });

  test('adds once per story, reorders with clamping', () => {
    addToWalk(stop(2));
    expect(getWalkStops()).toHaveLength(3);

    moveWalkStop(1, -1);
    expect(getWalkStops().map((s) => s.pageId)).toEqual([2, 1, 3]);
    moveWalkStop(0, -1);
    moveWalkStop(2, 1);
    expect(getWalkStops().map((s) => s.pageId)).toEqual([2, 1, 3]);
  });
});

describe('walkStopFromStory', () => {
  test('carries the extract so the walk can be told, and cuts the hook at the first sentence', () => {
    const walkStop = walkStopFromStory({
      pageId: 7,
      title: 'Palace of Placentia',
      coordinates: { latitude: 51.48, longitude: 0 },
      distanceMeters: 100,
      extract: 'Built in 1443. Demolished in the 17th century.',
      url: 'https://en.wikipedia.org/wiki/Palace_of_Placentia',
      source: 'Wikipedia',
    });

    expect(walkStop.extract).toBe('Built in 1443. Demolished in the 17th century.');
    expect(walkStop.hook).toBe('Built in 1443.');
    expect(walkStop.source).toBe('Wikipedia');
  });
});
