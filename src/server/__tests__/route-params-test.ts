/**
 * Absence is not zero — for every route that takes numbers off a URL,
 * not just the one where it was found (#305).
 *
 * `Number.isFinite(Number(param))` reads like a guard and is half of
 * one: `Number('abc')` is `NaN` and refused, but `Number(null)` is
 * `0`, `Number('')` is `0` and `Number(' ')` is `0`, all finite. So a
 * request with NO coordinates resolved to (0, 0) — Null Island, in
 * the Gulf of Guinea — and /api/area composed and CACHED it as a
 * legitimate place. Nothing reported it, because a plausible answer
 * never does.
 *
 * The table below is the point of this file. The bug was found once
 * and lived in two other routes; a fourth route added next month
 * belongs here, and gets the same eight questions asked of it.
 */
import { GET as areaGET } from '@/app/api/area+api';
import { GET as historyGET } from '@/app/api/history+api';
import { GET as routeGET } from '@/app/api/route+api';
import { GET as storyGET } from '@/app/api/story+api';
import { findNearestArea } from '@/server/area';
import { fetchWalkingRoute } from '@/server/route';
import { fetchStoryByPageId, findNearbyHistory } from '@/server/wikipedia';

// Hermetic: these routes' bucket caches must not answer for them, or
// "the guard refuses nothing real" could pass on a cache hit
jest.mock('@/server/ai-cache', () => ({
  diskBackedMap: () => new Map(),
  backgroundWorkSurvives: true,
}));
jest.mock('@/server/area', () => ({ findNearestArea: jest.fn() }));
jest.mock('@/server/route', () => ({ fetchWalkingRoute: jest.fn() }));
jest.mock('@/server/wikipedia', () => ({
  findNearbyHistory: jest.fn(),
  fetchStoryByPageId: jest.fn(),
}));
jest.mock('@/server/heritage', () => ({
  fetchListedBuildings: jest.fn(async () => []),
  fetchPlaques: jest.fn(async () => []),
  mergeHistorySources: jest.fn(() => []),
  enrichStandaloneListed: jest.fn(async () => []),
}));
jest.mock('@/server/geograph', () => ({ dressWithPhotos: jest.fn(async () => []) }));
jest.mock('@/server/plaque-subject', () => ({ resolvePlaqueSubjects: jest.fn(async () => []) }));
jest.mock('@/server/wikidata', () => ({ fetchExistenceFacts: jest.fn(async () => new Map()) }));

/** Every route that reads a number off the URL, with the work it must
 * never reach and one query that legitimately does reach it. */
const routes = [
  {
    name: '/api/area',
    GET: areaGET,
    work: findNearestArea as jest.Mock,
    valid: '?lat=51.4826&lng=-0.0077',
    params: ['lat', 'lng'],
  },
  {
    name: '/api/history',
    GET: historyGET,
    work: findNearbyHistory as jest.Mock,
    valid: '?lat=51.4826&lng=-0.0077',
    params: ['lat', 'lng'],
  },
  {
    name: '/api/route',
    GET: routeGET,
    work: fetchWalkingRoute as jest.Mock,
    valid: '?fromLat=51.48&fromLng=-0.01&toLat=51.49&toLng=-0.02',
    params: ['fromLat', 'fromLng', 'toLat', 'toLng'],
  },
  {
    name: '/api/story',
    GET: storyGET,
    work: fetchStoryByPageId as jest.Mock,
    valid: '?pageId=40729675',
    params: ['pageId'],
  },
] as const;

beforeEach(() => {
  for (const { work } of routes) {
    work.mockReset();
    work.mockResolvedValue(null);
  }
  delete process.env.E2E_FIXTURES;
  delete process.env.TURSO_DATABASE_URL;
});

describe.each(routes)('$name coordinate validation', ({ GET, work, valid, params }) => {
  async function ask(query: string): Promise<Response> {
    return GET(new Request(`http://localhost/api/x${query}`));
  }

  test('every parameter missing is a 400, not a request for (0, 0)', async () => {
    const response = await ask('');

    expect(response.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  test.each(params)('a missing %s alone is a 400 — absence is not zero', async (missing) => {
    // Drop exactly one parameter from the query that otherwise works
    const query = new URLSearchParams(valid.slice(1));
    query.delete(missing);

    const response = await ask(`?${query}`);

    expect(response.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  test.each(params)('an empty %s is a 400 — `Number("")` is 0 and finite', async (empty) => {
    const query = new URLSearchParams(valid.slice(1));
    query.set(empty, '');

    const response = await ask(`?${query}`);

    expect(response.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  test.each(params)('a whitespace %s is a 400 — `Number(" ")` is 0 too', async (blank) => {
    const query = new URLSearchParams(valid.slice(1));
    query.set(blank, '   ');

    const response = await ask(`?${query}`);

    expect(response.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  test.each(params)('a non-numeric %s is still a 400 — the half that worked', async (garbage) => {
    const query = new URLSearchParams(valid.slice(1));
    query.set(garbage, 'somewhere');

    const response = await ask(`?${query}`);

    expect(response.status).toBe(400);
    expect(work).not.toHaveBeenCalled();
  });

  test('a complete, numeric query does reach the work — the guard refuses nothing real', async () => {
    const response = await ask(valid);

    expect(response.status).not.toBe(400);
    expect(work).toHaveBeenCalled();
  });
});
