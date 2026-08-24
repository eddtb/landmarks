import type { Coordinates } from '@/utils/geo';
import type { TileFile, TileStory } from '@/utils/tiles';
import { tileKey } from '@/utils/tiles';

const mockFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchNearbyHistory } = require('@/data/history-client') as typeof import('@/data/history-client');

const Center: Coordinates = { latitude: 53.96, longitude: -1.082 }; // York — no other suite mints this bucket

function serveBakedGround() {
  const cells = new Map<string, TileStory[]>();
  for (let i = 0; i < 30; i++) {
    const story: TileStory = {
      pageId: 9000 + i,
      title: `York story ${i}`,
      coordinates: {
        latitude: Center.latitude + 0.002 * Math.sin(i),
        longitude: Center.longitude + 0.003 * Math.cos(i),
      },
      extract: 'Walls…',
      url: `https://en.wikipedia.org/?curid=${9000 + i}`,
    };
    const cell = tileKey(story.coordinates);
    cells.set(cell, [...(cells.get(cell) ?? []), story]);
  }
  mockFetch.mockImplementation((url: string) => {
    if (String(url).includes('/api/')) {
      // The whole point of the baked road: composing is over. An API
      // ask while tiles answer is the regression this test exists for.
      throw new Error(`unexpected API ask: ${url}`);
    }
    if (String(url).endsWith('/v1/manifest.json')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ tiles: cells.size }) });
    }
    const cell = String(url).match(/\/v1\/(.+)\.json$/)?.[1];
    if (!cell || !cells.has(cell)) {
      return Promise.resolve({ ok: false, status: 404 });
    }
    const tile: TileFile = { v: 1, cell, stories: cells.get(cell)! };
    return Promise.resolve({ ok: true, status: 200, json: async () => tile });
  });
}

describe('fetchNearbyHistory over the baked road', () => {
  beforeEach(() => mockFetch.mockReset());

  test('a published tile store serves the whole feed — /api/history is never asked', async () => {
    serveBakedGround();

    const feed = await fetchNearbyHistory(Center);

    expect(feed.items).toHaveLength(30);
    expect(feed.items[0].source).toBe('Wikipedia');
    expect(feed.items[0].distanceMeters).toBeLessThanOrEqual(feed.items[29].distanceMeters);
    expect(feed.sparse).toBeUndefined();
  });

  test('the baked feed lands in the same bucket cache — a repeat ask fetches nothing', async () => {
    serveBakedGround();
    const first = await fetchNearbyHistory(Center);

    mockFetch.mockClear();
    const second = await fetchNearbyHistory(Center);

    expect(second).toBe(first); // the identity contract useHistory bails on
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
