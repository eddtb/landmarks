import { GET } from '@/app/api/story+api';
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

describe('GET /api/story', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    delete process.env.E2E_FIXTURES;
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
  });
});
