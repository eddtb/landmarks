/**
 * The compose route on the EDGE runtime (no filesystem, no surviving
 * background work): the serve-early bargain is off. The response waits
 * for the photo leg it would have floated — because a floated finalize
 * dies with the isolate (#232) and the dressing:true snapshot would
 * re-serve forever. Same suite shape as history-compose-route-test,
 * with backgroundWorkSurvives: false.
 */
import { GET } from '@/app/api/history+api';
import { dressWithPhotos } from '@/server/geograph';
import { HistoryItem } from '@/types/history';

jest.mock('@/server/ai-cache', () => {
  const maps = new Map<string, Map<string, unknown>>();
  return {
    __maps: maps,
    backgroundWorkSurvives: false,
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
jest.mock('@/server/geograph', () => ({
  dressWithPhotos: jest.fn(async (items: HistoryItem[]) => items),
}));
jest.mock('@/server/plaque-subject', () => ({
  resolvePlaqueSubjects: jest.fn(async (plaques: HistoryItem[]) => plaques),
}));
jest.mock('@/server/wikidata', () => ({
  fetchExistenceFacts: jest.fn(async () => new Map()),
}));
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
const mockDress = dressWithPhotos as jest.Mock;

const cacheMaps = (
  jest.requireMock('@/server/ai-cache') as { __maps: Map<string, Map<string, unknown>> }
).__maps;
const listMap = () => cacheMaps.get('history-lists-v7')!;

function story(pageId: number, title: string): HistoryItem {
  return {
    pageId,
    title,
    coordinates: { latitude: 51.48, longitude: -0.01 },
    distanceMeters: 100 + pageId,
    url: `https://en.wikipedia.org/wiki/${title.replace(/\s+/g, '_')}`,
    source: 'Wikipedia',
  };
}

const backbone = Array.from({ length: 30 }, (_, i) => story(i + 1, `Story ${i + 1}`));

let latSeed = 52.5; // clear of the sibling suite's buckets
function freshRequest(): Request {
  latSeed += 0.01;
  return new Request(`http://localhost/api/history?lat=${latSeed.toFixed(3)}&lng=-0.01`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type FeedBody = { items: HistoryItem[]; dressing?: boolean };

describe('GET /api/history on the edge runtime', () => {
  beforeEach(() => {
    cacheMaps.forEach((map) => map.clear());
    findNearbyHistory.mockReset().mockResolvedValue(backbone);
    mockDress.mockReset().mockImplementation(async (items: HistoryItem[]) => items);
  });

  test('a cold compose WAITS for the photo leg: dressed, unflagged, cached in one pass', async () => {
    mockDress.mockImplementationOnce(async (items: HistoryItem[]) => {
      // The leg outlives the old 150ms grace — the edge must still wait
      await new Promise((resolve) => setTimeout(resolve, 200));
      return items.map((item) => ({ ...item, thumbnailUrl: 'https://img/1.jpg' }));
    });

    const body = (await (await GET(freshRequest())).json()) as FeedBody;

    expect(body.dressing).toBeUndefined();
    expect(body.items.every((item) => item.thumbnailUrl)).toBe(true);
    // The dressed verdict was cached BEFORE the response went out —
    // nothing rides behind it on a frozen isolate
    expect(listMap().size).toBe(1);
  });

  test('a failed photo leg serves the text-complete list flagged, and caches NOTHING', async () => {
    mockDress.mockImplementationOnce(async () => {
      throw new Error('geograph down');
    });

    const body = (await (await GET(freshRequest())).json()) as FeedBody;

    expect(body.dressing).toBe(true);
    expect(body.items).toHaveLength(30);
    expect(listMap().size).toBe(0); // couldn't-try is not tried-and-failed
  });

  test('a warm cache read never floats the background warm-up dress', async () => {
    const request = freshRequest();
    await GET(request); // compose + cache
    mockDress.mockClear();

    await GET(request); // warm read
    await flush();

    // Exactly the zero-lookup re-dress — no floated second call that
    // the frozen isolate would kill mid-flight
    expect(mockDress).toHaveBeenCalledTimes(1);
    expect(mockDress).toHaveBeenCalledWith(expect.anything(), undefined, undefined, 0, 0);
  });
});
