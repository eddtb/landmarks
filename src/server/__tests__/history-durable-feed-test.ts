/**
 * The feed's durable cache. The per-process map is per-ISOLATE on the
 * edge, so a "1 hour" bucket lasted minutes and nearly every reader
 * paid for a four-upstream compose — slow, and enough Wikipedia
 * traffic to get the worker's egress rate-limited, which the app
 * reports honestly as "you're offline".
 *
 * The invariants pinned here are the ones that make that true or not:
 * a stored feed answers WITHOUT composing, a compose is stored where
 * the next isolate can find it, and a refused compose falls back to
 * the store rather than erroring at a reader who is perfectly online.
 */
import { GET } from '@/app/api/history+api';
import { HistoryItem } from '@/types/history';

jest.mock('@/server/ai-cache', () => {
  const maps = new Map<string, Map<string, unknown>>();
  return {
    __maps: maps,
    backgroundWorkSurvives: false, // the edge: where the map dies with the isolate
    diskBackedMap: (name: string) => {
      const existing = maps.get(name);
      if (existing) {
        return existing;
      }
      const map = new Map();
      maps.set(name, map);
      return map;
    },
  };
});
jest.mock('@/server/telling-store', () => ({
  storeGet: jest.fn(async () => undefined),
  storePut: jest.fn(async () => undefined),
}));
jest.mock('@/server/geograph', () => ({
  dressWithPhotos: jest.fn(async (items: HistoryItem[]) => items),
}));
jest.mock('@/server/plaque-subject', () => ({
  resolvePlaqueSubjects: jest.fn(async (p: HistoryItem[]) => p),
}));
jest.mock('@/server/wikidata', () => ({ fetchExistenceFacts: jest.fn(async () => new Map()) }));
jest.mock('@/server/wikipedia', () => ({ findNearbyHistory: jest.fn() }));
jest.mock('@/server/heritage', () => {
  const actual = jest.requireActual('@/server/heritage');
  return {
    ...actual,
    fetchListedBuildings: jest.fn(async () => []),
    fetchPlaques: jest.fn(async () => []),
    enrichStandaloneListed: jest.fn(async (items: HistoryItem[]) => items),
  };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findNearbyHistory } = require('@/server/wikipedia') as { findNearbyHistory: jest.Mock };
const { storeGet, storePut } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/server/telling-store') as { storeGet: jest.Mock; storePut: jest.Mock };
const cacheMaps = (
  jest.requireMock('@/server/ai-cache') as { __maps: Map<string, Map<string, unknown>> }
).__maps;

function story(pageId: number): HistoryItem {
  return {
    pageId,
    title: `Story ${pageId}`,
    coordinates: { latitude: 51.48, longitude: -0.01 },
    distanceMeters: 100 + pageId,
    url: `https://en.wikipedia.org/wiki/Story_${pageId}`,
    source: 'Wikipedia',
  };
}
const fresh = Array.from({ length: 30 }, (_, i) => story(i + 1));
const remembered = [story(900), story(901)];

let latSeed = 53.5; // clear of the sibling suites' buckets
function freshRequest(): Request {
  latSeed += 0.01;
  return new Request(`http://localhost/api/history?lat=${latSeed.toFixed(3)}&lng=-0.01`);
}

type FeedBody = { items: HistoryItem[]; dressing?: boolean; error?: string };

describe('the feed s durable cache', () => {
  beforeEach(() => {
    cacheMaps.forEach((map) => map.clear());
    findNearbyHistory.mockReset().mockResolvedValue(fresh);
    storeGet.mockReset().mockResolvedValue(undefined);
    storePut.mockReset().mockResolvedValue(undefined);
  });

  test('a stored feed answers without touching a single upstream', async () => {
    storeGet.mockResolvedValue({ value: { items: remembered }, at: Date.now() - 60_000 });

    const body = (await (await GET(freshRequest())).json()) as FeedBody;

    expect(body.items.map((i) => i.pageId)).toEqual([900, 901]);
    expect(findNearbyHistory).not.toHaveBeenCalled(); // the whole point
    expect(body.dressing).toBeUndefined();
  });

  test('a store hit keeps the ORIGINAL age — the hour is not restarted per isolate', async () => {
    const composedAt = Date.now() - 59 * 60 * 1000; // 59 minutes old
    storeGet.mockResolvedValue({ value: { items: remembered }, at: composedAt });

    await GET(freshRequest());

    const seeded = [...cacheMaps.get('history-lists-v7')!.values()][0] as { at: number };
    expect(seeded.at).toBe(composedAt);
  });

  test('a stored feed past its hour does NOT answer — the ground is re-asked', async () => {
    storeGet.mockResolvedValue({
      value: { items: remembered },
      at: Date.now() - 61 * 60 * 1000,
    });

    const body = (await (await GET(freshRequest())).json()) as FeedBody;

    expect(findNearbyHistory).toHaveBeenCalled();
    expect(body.items).toHaveLength(30); // the fresh compose, not the memory
  });

  test('a cold compose is stored where the next isolate will find it', async () => {
    await GET(freshRequest());

    expect(storePut).toHaveBeenCalledWith(
      'feed',
      expect.any(String),
      expect.objectContaining({ items: expect.any(Array) }),
      expect.any(Number)
    );
    const [, , entry] = storePut.mock.calls[0] as [string, string, { items: HistoryItem[] }];
    expect(entry.items).toHaveLength(30);
  });

  test('a REFUSED compose serves the stored feed — not "offline" at an online reader', async () => {
    // Wikipedia rate-limits by egress IP: one worker's busy minute
    // becomes every reader's error unless we remember something
    findNearbyHistory.mockRejectedValue(new Error('429 Too Many Requests'));
    storeGet.mockResolvedValue({
      value: { items: remembered },
      at: Date.now() - 3 * 60 * 60 * 1000, // hours stale — still better than nothing
    });

    const response = await GET(freshRequest());
    const body = (await response.json()) as FeedBody;

    expect(response.status).toBe(200);
    expect(body.items.map((i) => i.pageId)).toEqual([900, 901]);
  });

  test('a refused compose with nothing remembered is still an honest error', async () => {
    findNearbyHistory.mockRejectedValue(new Error('429 Too Many Requests'));
    storeGet.mockResolvedValue(undefined);

    const response = await GET(freshRequest());

    expect(response.status).toBe(502);
  });

  test('with the store off, the route behaves exactly as it did before it existed', async () => {
    storeGet.mockResolvedValue(undefined); // absent config answers like a miss
    storePut.mockRejectedValue(new Error('should never be awaited unguarded'));

    const response = await GET(freshRequest());
    const body = (await response.json()) as FeedBody;

    // A write that rejects must not take the response down with it —
    // nor quietly downgrade a complete feed to a flagged one, which
    // is what happened before this assertion existed
    expect(response.status).toBe(200);
    expect(body.items).toHaveLength(30);
    expect(body.dressing).toBeUndefined();
    expect(cacheMaps.get('history-lists-v7')!.size).toBe(1); // still cached in-process
  });
});
