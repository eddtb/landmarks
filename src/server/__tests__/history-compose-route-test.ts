/**
 * The cold-compose overlap and early serve (#201): once the text is
 * complete (merge + enrichment + existence tags) the response goes out
 * — a still-running photo leg rides behind a `dressing: true` flag.
 * The invariants under test:
 *   - the bucket cache NEVER holds the undressed list; only the final
 *     dressed verdict is a cacheable answer
 *   - a failed photo leg caches nothing (couldn't-try ≠ tried-and-failed)
 *   - a request landing inside the dressing window gets the serve-once
 *     snapshot again instead of re-firing the upstream fan-out
 *   - warm photo caches (dressing settles instantly) mean a plain
 *     dressed response, no flag, cached immediately
 */
import { GET } from '@/app/api/history+api';
import { dressWithPhotos } from '@/server/geograph';
import { fetchExistenceFacts } from '@/server/wikidata';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';

// One inspectable map per cache name — the route's listCache included
jest.mock('@/server/ai-cache', () => {
  const maps = new Map<string, Map<string, unknown>>();
  return {
    __maps: maps,
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

const mockFindNearby = findNearbyHistory as jest.Mock;
const mockDress = dressWithPhotos as jest.Mock;
const mockTags = fetchExistenceFacts as jest.Mock;

const cacheMaps = (
  jest.requireMock('@/server/ai-cache') as { __maps: Map<string, Map<string, unknown>> }
).__maps;
const listMap = () => cacheMaps.get('history-lists-v6')!;

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

// 30 stories: past the sparse threshold, so nothing widens
const backbone = Array.from({ length: 30 }, (_, i) => story(i + 1, `Story ${i + 1}`));

// Distinct buckets per test — the module-level caches survive between tests
let latSeed = 51.5;
function freshRequest(): Request {
  latSeed += 0.01;
  return new Request(`http://localhost/api/history?lat=${latSeed.toFixed(3)}&lng=-0.01`);
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

type FeedBody = { items: HistoryItem[]; dressing?: boolean };

describe('GET /api/history cold-compose early serve', () => {
  beforeEach(() => {
    cacheMaps.forEach((map) => map.clear());
    mockFindNearby.mockReset().mockResolvedValue(backbone);
    mockTags.mockReset().mockResolvedValue(new Map());
    mockDress.mockReset().mockImplementation(async (items: HistoryItem[]) => items);
  });

  test('photos pending: the response arrives tagged but undressed, flagged — and the dressed verdict is what gets cached', async () => {
    let resolveDress!: (items: HistoryItem[]) => void;
    mockDress.mockImplementationOnce(
      (items: HistoryItem[]) =>
        new Promise<HistoryItem[]>((resolve) => {
          resolveDress = (dressed) => resolve(dressed ?? items);
        })
    );
    // Tags resolve on a real tick — dressing stays pending past them
    mockTags.mockImplementation(async () => {
      await flush();
      return new Map([
        ['Story 1', { tag: 'Demolished 1936' }],
        ['Story 3', { event: true }], // events-are-history: the flag rides the same facts leg
      ]);
    });

    const request = freshRequest();
    const response = await GET(request);
    const body = (await response.json()) as FeedBody;

    // Served before the photo leg: flagged, text-complete, facts applied
    expect(body.dressing).toBe(true);
    expect(body.items).toHaveLength(30);
    expect(body.items[0].pastTag).toBe('Demolished 1936');
    expect(body.items[2].event).toBe(true);
    expect(body.items[1].event).toBeUndefined();
    expect(body.items.some((item) => item.thumbnailUrl)).toBe(false);
    // The undressed list is serve-once: NOT the bucket's cached verdict
    expect(listMap().size).toBe(0);

    // The photo leg lands → the dressed list (tags riding along) is cached
    resolveDress(backbone.map((item) => ({ ...item, thumbnailUrl: 'https://img/1.jpg' })));
    await flush();
    expect(listMap().size).toBe(1);
    const cached = [...listMap().values()][0] as { items: HistoryItem[] };
    expect(cached.items.every((item) => item.thumbnailUrl)).toBe(true);
    expect(cached.items[0].pastTag).toBe('Demolished 1936');
    expect(cached.items[2].event).toBe(true);

    // The upgrade re-fetch (same bucket, no fresh): dressed, unflagged
    const upgraded = (await (await GET(request)).json()) as FeedBody;
    expect(upgraded.dressing).toBeUndefined();
    expect(upgraded.items.every((item) => item.thumbnailUrl)).toBe(true);
  });

  test('a request inside the dressing window gets the snapshot again — no second upstream fan-out', async () => {
    mockDress.mockImplementationOnce(() => new Promise<HistoryItem[]>(() => {}));
    mockTags.mockImplementation(async () => {
      await flush();
      return new Map();
    });

    const request = freshRequest();
    const first = (await (await GET(request)).json()) as FeedBody;
    expect(first.dressing).toBe(true);
    expect(mockFindNearby).toHaveBeenCalledTimes(1);

    const second = (await (await GET(request)).json()) as FeedBody;
    expect(second.dressing).toBe(true);
    expect(second.items).toHaveLength(30);
    expect(mockFindNearby).toHaveBeenCalledTimes(1); // served from the snapshot
    expect(listMap().size).toBe(0); // still nothing cached
  });

  test('a failed photo leg is never cached as a verdict — the next request retries the compose', async () => {
    let rejectDress!: (error: Error) => void;
    mockDress.mockImplementationOnce(
      () => new Promise<HistoryItem[]>((_, reject) => (rejectDress = reject))
    );
    mockTags.mockImplementation(async () => {
      await flush();
      return new Map();
    });

    const request = freshRequest();
    const body = (await (await GET(request)).json()) as FeedBody;
    expect(body.dressing).toBe(true); // the user still got their stories

    rejectDress(new Error('Geograph down'));
    await flush();
    expect(listMap().size).toBe(0); // couldn't-try ≠ tried-and-failed

    // Snapshot cleared with the failure: the next ask recomposes
    await GET(request);
    expect(mockFindNearby).toHaveBeenCalledTimes(2);
  });

  test('dressing already settled (warm photo caches): dressed response, no flag, cached immediately', async () => {
    mockDress.mockImplementationOnce(async (items: HistoryItem[]) =>
      items.map((item) => ({ ...item, thumbnailUrl: 'https://img/warm.jpg' }))
    );
    mockTags.mockImplementation(async () => {
      await flush(); // dressing settles first — the race picks it
      return new Map([['Story 2', { tag: 'Until 1675' }]]);
    });

    const body = (await (await GET(freshRequest())).json()) as FeedBody;

    expect(body.dressing).toBeUndefined();
    expect(body.items.every((item) => item.thumbnailUrl)).toBe(true);
    expect(body.items[1].pastTag).toBe('Until 1675');
    expect(listMap().size).toBe(1);
  });
});
