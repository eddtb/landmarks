import {
  MaxArrivalRegions,
  ReannounceAfterMs,
  armedRegion,
  armedRegions,
  arrivalsEnabled,
  markAnnounced,
  recentlyAnnounced,
  sameArmedSet,
  selectArrivalRegions,
  setArmedRegions,
  setArrivalsEnabled,
  setArrivalsForTests,
} from '@/data/arrivals';
import { HistoryItem } from '@/types/history';

const item = (
  pageId: number,
  title: string,
  distanceMeters: number,
  extra: Partial<HistoryItem> = {}
): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters,
  extract: `${title} was built in 1720 and stood for two centuries.`,
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
  ...extra,
});

beforeEach(() => {
  setArrivalsForTests({ enabled: true });
});

describe('selectArrivalRegions', () => {
  it('takes the nearest first', () => {
    const regions = selectArrivalRegions(
      [item(3, 'Far', 900), item(1, 'Near', 50), item(2, 'Middle', 400)],
      []
    );
    expect(regions.map((region) => region.title)).toEqual(['Near', 'Middle', 'Far']);
  });

  it('sorts by distance rather than trusting the caller', () => {
    // The feed arrives sorted; the saved shelf does not
    const regions = selectArrivalRegions([item(2, 'Middle', 400), item(1, 'Near', 50)], []);
    expect(regions[0].title).toBe('Near');
  });

  it("holds slots for saved places ahead of anything nearer", () => {
    const nearby = Array.from({ length: MaxArrivalRegions }, (_, index) =>
      item(100 + index, `Nearby ${index}`, index)
    );
    const regions = selectArrivalRegions(nearby, [item(7, 'Chosen', 5000)]);

    expect(regions).toHaveLength(MaxArrivalRegions);
    expect(regions[0].title).toBe('Chosen');
    // The furthest nearby place is the one evicted, not the choice
    expect(regions.map((region) => region.pageId)).not.toContain(119);
  });

  it("never exceeds the platform's region ceiling", () => {
    const nearby = Array.from({ length: 60 }, (_, index) =>
      item(index, `Place ${index}`, index * 10)
    );
    expect(selectArrivalRegions(nearby, [])).toHaveLength(MaxArrivalRegions);
  });

  it('leaves out events and areas — there is no doorstep to arrive at', () => {
    const regions = selectArrivalRegions(
      [
        item(1, 'A Building', 10),
        item(2, 'A Train Crash', 20, { event: true }),
        item(3, 'Greenwich', 30, { area: true }),
      ],
      []
    );
    expect(regions.map((region) => region.title)).toEqual(['A Building']);
  });

  it('excludes an event even when it was saved', () => {
    expect(selectArrivalRegions([], [item(2, 'A Fire', 20, { event: true })])).toEqual([]);
  });

  it('counts a saved place that is also nearby only once', () => {
    const shared = item(5, 'Both', 30);
    const regions = selectArrivalRegions([shared, item(6, 'Other', 40)], [shared]);
    expect(regions.map((region) => region.pageId)).toEqual([5, 6]);
  });

  it("carries a plaque's resolved subject as the name, not the inscription", () => {
    const regions = selectArrivalRegions([item(1, 'Erected by the council…', 10, { subject: 'Ada Lovelace' })], []);
    expect(regions[0].title).toBe('Ada Lovelace');
  });

  it('carries a hook the cold task can read without a network', () => {
    const regions = selectArrivalRegions([item(1, 'The Mill', 10)], []);
    expect(regions[0].hook).toContain('built in 1720');
  });

  it('survives a place with no extract to hook from', () => {
    const regions = selectArrivalRegions([item(1, 'Bare', 10, { extract: undefined })], []);
    expect(regions[0].hook).toBeUndefined();
  });
});

describe('sameArmedSet', () => {
  const region = (pageId: number) => ({
    pageId,
    title: `P${pageId}`,
    coordinates: { latitude: 51.48, longitude: 0 },
  });

  it('ignores ordering — the set is what CoreLocation monitors', () => {
    expect(sameArmedSet([region(1), region(2)], [region(2), region(1)])).toBe(true);
  });

  it('sees a swap', () => {
    expect(sameArmedSet([region(1), region(2)], [region(1), region(3)])).toBe(false);
  });

  it('sees a change of size', () => {
    expect(sameArmedSet([region(1)], [region(1), region(2)])).toBe(false);
  });
});

describe('the announcement ledger', () => {
  it('lets a place speak once inside the window and again after it', () => {
    const now = 1_700_000_000_000;
    setArmedRegions(selectArrivalRegions([item(1, 'The Mill', 10)], []));

    expect(recentlyAnnounced(1, now)).toBe(false);
    markAnnounced(1, now);
    expect(recentlyAnnounced(1, now + 1000)).toBe(true);
    expect(recentlyAnnounced(1, now + ReannounceAfterMs + 1)).toBe(false);
  });

  it('forgets places that have left the armed set', () => {
    const now = 1_700_000_000_000;
    setArmedRegions(selectArrivalRegions([item(1, 'The Mill', 10)], []));
    markAnnounced(1, now);

    // Walking on: a new twenty, and the old mark is dead weight in a
    // store read on every cold background wake
    setArmedRegions(selectArrivalRegions([item(2, 'The Wharf', 10)], []));
    expect(recentlyAnnounced(1, now + 1000)).toBe(false);
  });
});

describe('the opt-in', () => {
  it('starts off', () => {
    setArrivalsForTests({});
    expect(arrivalsEnabled()).toBe(false);
  });

  it('clears the armed table when switched off, so nothing stale can be named', () => {
    setArmedRegions(selectArrivalRegions([item(1, 'The Mill', 10)], []));
    expect(armedRegion(1)).toBeDefined();

    setArrivalsEnabled(false);
    expect(arrivalsEnabled()).toBe(false);
    expect(armedRegions()).toEqual([]);
    expect(armedRegion(1)).toBeUndefined();
  });

  it('ignores writes before hydration rather than inventing a state', () => {
    setArrivalsForTests(null);
    setArrivalsEnabled(true);
    expect(arrivalsEnabled()).toBe(false);
  });
});
