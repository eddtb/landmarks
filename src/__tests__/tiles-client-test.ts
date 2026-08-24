import { fetchTileFeed } from '@/data/tiles-client';
import type { Coordinates } from '@/utils/geo';
import type { TileFile, TileStory } from '@/utils/tiles';
import { tileKey } from '@/utils/tiles';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const mockFetch = jest.requireMock('expo/fetch').fetch as jest.Mock;

// Greenwich, mid-fixture: the same point the smoke bake was proven at
const Center: Coordinates = { latitude: 51.482, longitude: -0.008 };

function story(pageId: number, at: Coordinates, title = `Story ${pageId}`): TileStory {
  return { pageId, title, coordinates: at, extract: 'Once…', url: `https://en.wikipedia.org/?curid=${pageId}` };
}

/** Serve a bake from memory: manifest present, unknown cells 404,
 * like Pages does. `manifest: false` simulates an unpublished store. */
function serveTiles(stories: TileStory[], { status = 200, manifest = true } = {}) {
  const cells = new Map<string, TileStory[]>();
  for (const s of stories) {
    const cell = tileKey(s.coordinates);
    cells.set(cell, [...(cells.get(cell) ?? []), s]);
  }
  mockFetch.mockImplementation((url: string) => {
    if (url.endsWith('/v1/manifest.json')) {
      return Promise.resolve(
        manifest
          ? { ok: true, status: 200, json: () => Promise.resolve({ tiles: cells.size }) }
          : { ok: false, status: 404 }
      );
    }
    const cell = url.match(/\/v1\/(.+)\.json$/)?.[1];
    if (!cell || !cells.has(cell)) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    const tile: TileFile = { v: 1, cell, stories: cells.get(cell)! };
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(tile) });
  });
}

beforeEach(() => mockFetch.mockReset());

// 30+ stories in a ~300m ring keep the feed above the sparse threshold
function denseGround(): TileStory[] {
  return Array.from({ length: 30 }, (_, i) =>
    story(1000 + i, {
      latitude: Center.latitude + 0.003 * Math.sin(i),
      longitude: Center.longitude + 0.004 * Math.cos(i),
    })
  );
}

describe('fetchTileFeed', () => {
  it('merges covering cells into a nearest-first feed with viewer fields added', async () => {
    const near = story(1, { latitude: 51.4828, longitude: -0.0097 }, 'Cutty Sark');
    const farther = story(2, { latitude: 51.4705, longitude: 0.001 }, 'Across the cell line');
    serveTiles([...denseGround(), near, farther]);

    const feed = await fetchTileFeed(Center);

    expect(feed.items[0].title).toBe('Cutty Sark');
    expect(feed.items[0].source).toBe('Wikipedia');
    expect(feed.items[0].distanceMeters).toBeGreaterThan(0);
    expect(feed.items.map((i) => i.pageId)).toContain(2);
    const distances = feed.items.map((i) => i.distanceMeters);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    expect(feed.sparse).toBeUndefined();
  });

  it('leaves stories beyond the walk radius out, even when their cell came along', async () => {
    // Same cell row as the center but ~2.5km east — inside a fetched
    // cell's bounds is not inside the walk
    serveTiles([...denseGround(), story(9, { latitude: 51.482, longitude: 0.028 }, 'Too far')]);

    const feed = await fetchTileFeed(Center);

    expect(feed.items.map((i) => i.title)).not.toContain('Too far');
  });

  it('treats a missing tile as an empty cell, not a failure', async () => {
    serveTiles(denseGround()); // every OTHER covering cell 404s

    await expect(fetchTileFeed(Center)).resolves.toBeTruthy();
  });

  it('widens to the sparse horizon and says so, without refetching near cells', async () => {
    // Three stories close in, the rest only reachable at 3 km
    const quiet = [
      story(1, { latitude: 51.4825, longitude: -0.009 }),
      story(2, { latitude: 51.484, longitude: -0.006 }),
      story(3, { latitude: 51.4805, longitude: -0.0105 }),
      story(4, { latitude: 51.503, longitude: -0.008 }, 'At the horizon'),
    ];
    serveTiles(quiet);

    const feed = await fetchTileFeed(Center);

    expect(feed.sparse).toBe(true);
    expect(feed.horizon).toBe(3000);
    expect(feed.items.map((i) => i.title)).toContain('At the horizon');
    const asked = mockFetch.mock.calls.map(([url]) => url);
    expect(new Set(asked).size).toBe(asked.length); // no cell fetched twice
  });

  it('caps the deep feed at 150', async () => {
    const crowd = Array.from({ length: 400 }, (_, i) =>
      story(i + 1, {
        latitude: Center.latitude + (i % 20) * 0.0005,
        longitude: Center.longitude + Math.floor(i / 20) * 0.0007,
      })
    );
    serveTiles(crowd);

    const feed = await fetchTileFeed(Center);

    expect(feed.items).toHaveLength(150);
  });

  it('throws on a broken tile rather than assembling half a feed', async () => {
    serveTiles(denseGround(), { status: 503 });

    await expect(fetchTileFeed(Center)).rejects.toThrow();
  });

  it('carries the baked existence facts through to the feed item', async () => {
    // The whole reason the facts stage exists: pastTag decorates the
    // card and event keeps a crash out of Nearby — both must survive
    // the tile → HistoryItem conversion untouched
    const palace = {
      ...story(7, { latitude: 51.4826, longitude: -0.0077 }, 'Placentia Palace'),
      pastTag: 'Demolished 1694',
    };
    const crash = {
      ...story(8, { latitude: 51.4815, longitude: -0.0095 }, 'A rail crash'),
      event: true as const,
    };
    serveTiles([...denseGround(), palace, crash]);

    const feed = await fetchTileFeed(Center);

    const gotPalace = feed.items.find((i) => i.pageId === 7);
    const gotCrash = feed.items.find((i) => i.pageId === 8);
    expect(gotPalace?.pastTag).toBe('Demolished 1694');
    expect(gotCrash?.event).toBe(true);
  });

  it('throws when the store itself is absent, so all-404s never read as empty ground', async () => {
    // Every cell 404s exactly as an unpublished Pages site would —
    // only the missing manifest tells this apart from the open sea
    serveTiles([], { manifest: false });

    await expect(fetchTileFeed(Center)).rejects.toThrow();
  });
});
