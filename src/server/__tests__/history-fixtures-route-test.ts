/**
 * The /api/history fixtures gate: near the CI pin it serves the dense
 * Greenwich recording, far away it serves the sparse-area recording
 * (falling back to dense), the outage flag turns it into a 503, and
 * with the flag off the whole gate is skipped — the route talks to
 * (mocked) upstreams exactly as before, fixtures on disk or not.
 * That last one is the byte-identical-with-flag-off invariant.
 */
import { GET } from '@/app/api/history+api';
import { GET as outageGET } from '@/app/api/e2e-outage+api';
import { setOutage } from '@/server/fixtures';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';

jest.mock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
jest.mock('@/server/geograph', () => ({
  dressWithPhotos: jest.fn(async (items: HistoryItem[]) => items),
}));
jest.mock('@/server/plaque-subject', () => ({
  resolvePlaqueSubjects: jest.fn(async (plaques: HistoryItem[]) => plaques),
}));
jest.mock('@/server/wikidata', () => ({
  fetchExistenceTags: jest.fn(async () => new Map()),
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

const mockFindNearby = findNearbyHistory as jest.Mock;

function story(pageId: number, title: string): HistoryItem {
  return {
    pageId,
    title,
    coordinates: { latitude: 51.48, longitude: -0.01 },
    distanceMeters: 100,
    url: `https://en.wikipedia.org/wiki/${title.replace(/\s+/g, '_')}`,
    source: 'Wikipedia',
  };
}

// The CI pin (Greenwich) and a genuinely faraway village
const greenwich = 'lat=51.4826&lng=-0.0077';
const faraway = 'lat=50.9169&lng=0.9762';

function historyRequest(query: string): Request {
  return new Request(`http://localhost/api/history?${query}`);
}

describe('GET /api/history under E2E fixtures', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(`${tmpdir()}/e2e-history-fixtures-`);
    process.env.E2E_FIXTURES_DIR = dir;
    writeFileSync(
      `${dir}/history.json`,
      JSON.stringify({ items: [story(1, 'Cutty Sark')] })
    );
    writeFileSync(
      `${dir}/history-sparse.json`,
      JSON.stringify({ items: [story(2, 'Dungeness Lighthouse')], sparse: true })
    );
  });

  afterAll(() => {
    delete process.env.E2E_FIXTURES;
    delete process.env.E2E_FIXTURES_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    process.env.E2E_FIXTURES = '1';
    mockFindNearby.mockReset();
    setOutage(false);
  });

  test('near the pin — the dense Greenwich recording', async () => {
    const response = await GET(historyRequest(greenwich));
    const body = (await response.json()) as { items: HistoryItem[]; sparse?: boolean };
    expect(body.items[0].title).toBe('Cutty Sark');
    expect(body.sparse).toBeUndefined();
    expect(mockFindNearby).not.toHaveBeenCalled();
  });

  test('far away — the sparse recording, sparse flag riding along', async () => {
    const response = await GET(historyRequest(faraway));
    const body = (await response.json()) as { items: HistoryItem[]; sparse?: boolean };
    expect(body.items[0].title).toBe('Dungeness Lighthouse');
    expect(body.sparse).toBe(true);
    expect(mockFindNearby).not.toHaveBeenCalled();
  });

  test('far away with no sparse recording — dense fallback, never a blank app', async () => {
    const bare = mkdtempSync(`${tmpdir()}/e2e-history-bare-`);
    writeFileSync(`${bare}/history.json`, JSON.stringify({ items: [story(1, 'Cutty Sark')] }));
    process.env.E2E_FIXTURES_DIR = bare;
    try {
      const response = await GET(historyRequest(faraway));
      const body = (await response.json()) as { items: HistoryItem[] };
      expect(body.items[0].title).toBe('Cutty Sark');
    } finally {
      process.env.E2E_FIXTURES_DIR = dir;
      rmSync(bare, { recursive: true, force: true });
    }
  });

  test('outage flag — 503 until switched off again', async () => {
    setOutage(true);
    expect((await GET(historyRequest(greenwich))).status).toBe(503);
    setOutage(false);
    expect((await GET(historyRequest(greenwich))).status).toBe(200);
  });

  test('bad coords still 400 — the gate never rescues an invalid request', async () => {
    expect((await GET(historyRequest('lat=abc&lng=1'))).status).toBe(400);
  });

  test('flag off — fixtures and outage flag on disk are both invisible', async () => {
    delete process.env.E2E_FIXTURES;
    setOutage(true); // present on disk, must not matter
    mockFindNearby.mockResolvedValue([story(3, 'Live Upstream Story')]);
    try {
      const response = await GET(historyRequest(greenwich));
      const body = (await response.json()) as { items: HistoryItem[] };
      expect(body.items[0].title).toBe('Live Upstream Story');
      expect(mockFindNearby).toHaveBeenCalled();
    } finally {
      setOutage(false);
    }
  });
});

describe('GET /api/e2e-outage', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(`${tmpdir()}/e2e-outage-route-`);
    process.env.E2E_FIXTURES_DIR = dir;
    writeFileSync(`${dir}/history.json`, JSON.stringify({ items: [] }));
  });

  afterAll(() => {
    delete process.env.E2E_FIXTURES;
    delete process.env.E2E_FIXTURES_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  test('inert without the flag — 404, nothing written', async () => {
    delete process.env.E2E_FIXTURES;
    const response = outageGET(new Request('http://localhost/api/e2e-outage?on=1'));
    expect(response.status).toBe(404);
    process.env.E2E_FIXTURES = '1';
    const check = await GET(historyRequest(greenwich));
    expect(check.status).toBe(200);
  });

  test('toggles the outage over HTTP', async () => {
    process.env.E2E_FIXTURES = '1';
    expect(outageGET(new Request('http://localhost/api/e2e-outage?on=1')).status).toBe(200);
    expect((await GET(historyRequest(greenwich))).status).toBe(503);
    expect(outageGET(new Request('http://localhost/api/e2e-outage?on=0')).status).toBe(200);
    expect((await GET(historyRequest(greenwich))).status).toBe(200);
  });
});
