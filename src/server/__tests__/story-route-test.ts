import { GET } from '@/app/api/story+api';
import { diskBackedMap } from '@/server/ai-cache';
import { HistoryItem } from '@/types/history';

// Same guarded require as fixtures-test: node-only test, app tsconfig
// has no node types
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { mkdtempSync, writeFileSync, rmSync } = require('fs') as {
  mkdtempSync: (prefix: string) => string;
  writeFileSync: (path: string, data: string) => void;
  rmSync: (path: string, options: { recursive: boolean; force: boolean }) => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { tmpdir } = require('os') as { tmpdir: () => string };

const mockFetch = jest.fn();
globalThis.fetch = mockFetch as unknown as typeof fetch;

function storyRequest(query: string): Request {
  return new Request(`http://localhost/api/story${query}`);
}

const fixtureItem: HistoryItem = {
  pageId: 42,
  title: 'Borough Compter',
  coordinates: { latitude: 51.5045, longitude: -0.0905 },
  distanceMeters: 112,
  url: 'https://en.wikipedia.org/wiki/Borough_Compter',
  source: 'Wikipedia',
};

const storyCache = diskBackedMap<{ item: HistoryItem; at: number }>('stories-v1');

describe('GET /api/story', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.E2E_FIXTURES;
    storyCache.clear();
  });

  test('rejects a missing or non-numeric pageId', async () => {
    expect((await GET(storyRequest(''))).status).toBe(400);
    expect((await GET(storyRequest('?pageId=abc'))).status).toBe(400);
    expect((await GET(storyRequest('?pageId=-3'))).status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('synthetic heritage ids 404 without touching Wikipedia', async () => {
    // A plaque (3e9+) and a bare register entry (2e9+) — neither has a
    // Wikipedia page to resolve; their shares keep the source URL
    expect((await GET(storyRequest('?pageId=3000031040'))).status).toBe(404);
    expect((await GET(storyRequest('?pageId=2000012345'))).status).toBe(404);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('resolves a live wiki pageId through the single-page query', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            '42': {
              pageid: 42,
              title: 'Borough Compter',
              extract: 'A small prison in Southwark...',
              thumbnail: { source: 'https://upload.wikimedia.org/compter.jpg' },
              fullurl: 'https://en.wikipedia.org/wiki/Borough_Compter',
              coordinates: [{ lat: 51.5045, lon: -0.0905 }],
            },
          },
        },
      }),
    });

    const response = await GET(storyRequest('?pageId=42'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { item: HistoryItem };
    expect(body.item).toMatchObject({
      pageId: 42,
      title: 'Borough Compter',
      coordinates: { latitude: 51.5045, longitude: -0.0905 },
      distanceMeters: 0, // a shared link carries no viewer location
      extract: 'A small prison in Southwark...',
      thumbnailUrl: 'https://upload.wikimedia.org/compter.jpg',
      url: 'https://en.wikipedia.org/wiki/Borough_Compter',
      source: 'Wikipedia',
    });
    expect(String(mockFetch.mock.calls[0][0])).toContain('pageids=42');
  });

  test('a pageid Wikipedia marks missing is a true 404', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ query: { pages: { '999': { pageid: 999, missing: '' } } } }),
    });

    expect((await GET(storyRequest('?pageId=999'))).status).toBe(404);
  });

  test('upstream failure is a 502, never a false "no story"', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 429 });

    expect((await GET(storyRequest('?pageId=42'))).status).toBe(502);
  });

  describe('server cache (#202)', () => {
    const livePage = (pageid: number, title: string) => ({
      ok: true,
      json: async () => ({
        query: {
          pages: {
            [String(pageid)]: {
              pageid,
              title,
              fullurl: `https://en.wikipedia.org/wiki/${title}`,
              coordinates: [{ lat: 51.5045, lon: -0.0905 }],
            },
          },
        },
      }),
    });

    test('a repeat ask serves from the cache without touching Wikipedia', async () => {
      mockFetch.mockResolvedValue(livePage(42, 'Borough Compter'));
      expect((await GET(storyRequest('?pageId=42'))).status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const repeat = await GET(storyRequest('?pageId=42'));
      expect(repeat.status).toBe(200);
      expect(((await repeat.json()) as { item: HistoryItem }).item.title).toBe('Borough Compter');
      expect(mockFetch).toHaveBeenCalledTimes(1); // no second upstream call
    });

    test('a stale entry re-asks upstream', async () => {
      const weekAndABit = 7 * 24 * 60 * 60 * 1000 + 60000;
      storyCache.set('42', { item: fixtureItem, at: Date.now() - weekAndABit });
      mockFetch.mockResolvedValue(livePage(42, 'Borough Compter'));

      expect((await GET(storyRequest('?pageId=42'))).status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('a 404 verdict is never cached — the repeat asks upstream again', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ query: { pages: { '999': { pageid: 999, missing: '' } } } }),
      });

      expect((await GET(storyRequest('?pageId=999'))).status).toBe(404);
      expect((await GET(storyRequest('?pageId=999'))).status).toBe(404);
      expect(mockFetch).toHaveBeenCalledTimes(2); // couldn't-find is not a fact for a week
      expect(storyCache.size).toBe(0);
    });

    test('an upstream failure is never cached — the repeat asks upstream again', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 429 });
      expect((await GET(storyRequest('?pageId=42'))).status).toBe(502);
      expect(storyCache.size).toBe(0);

      // The outage passes; the next ask succeeds live
      mockFetch.mockResolvedValueOnce(livePage(42, 'Borough Compter'));
      expect((await GET(storyRequest('?pageId=42'))).status).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('fixture mode (hermetic CI)', () => {
    let dir: string;

    beforeAll(() => {
      dir = mkdtempSync(`${tmpdir()}/story-route-test-`);
      process.env.E2E_FIXTURES_DIR = dir;
      writeFileSync(`${dir}/story-42.json`, JSON.stringify({ item: fixtureItem }));
      writeFileSync(
        `${dir}/history.json`,
        JSON.stringify({ items: [{ ...fixtureItem, pageId: 77, title: 'Cutty Sark' }] })
      );
    });

    afterAll(() => {
      delete process.env.E2E_FIXTURES;
      delete process.env.E2E_FIXTURES_DIR;
      rmSync(dir, { recursive: true, force: true });
    });

    beforeEach(() => {
      process.env.E2E_FIXTURES = '1';
    });

    test('a dedicated story fixture wins', async () => {
      const response = await GET(storyRequest('?pageId=42'));
      expect(response.status).toBe(200);
      expect(((await response.json()) as { item: HistoryItem }).item.title).toBe(
        'Borough Compter'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('falls through to the recorded history feed by pageId', async () => {
      const response = await GET(storyRequest('?pageId=77'));
      expect(response.status).toBe(200);
      expect(((await response.json()) as { item: HistoryItem }).item.title).toBe('Cutty Sark');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('unknown pageId stays a 404 — never a live call from CI', async () => {
      expect((await GET(storyRequest('?pageId=123456'))).status).toBe(404);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('the server cache neither serves nor fills in fixture mode', async () => {
      // A poisoned cache must not shadow the recorded fixture…
      storyCache.set('42', {
        item: { ...fixtureItem, title: 'Stale cached impostor' },
        at: Date.now(),
      });
      const response = await GET(storyRequest('?pageId=42'));
      expect(((await response.json()) as { item: HistoryItem }).item.title).toBe(
        'Borough Compter'
      );
      // …and fixture verdicts stay out of the real cache
      expect((await GET(storyRequest('?pageId=77'))).status).toBe(200);
      expect(storyCache.has('77')).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
