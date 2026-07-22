/**
 * Sparse-area mode: tuned on Greenwich, honest everywhere. The pure
 * decision (shouldWiden) and the route's widening behaviour — a thin
 * merge re-asks Wikipedia at 3000m, flags the response `sparse`, and
 * leaves dense areas byte-for-byte untouched.
 */
import { GET } from '@/app/api/history+api';
import { shouldWiden, SparseRadiusMeters, SparseStoryThreshold } from '@/server/sparse';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';

jest.mock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
jest.mock('@/server/fixtures', () => ({
  fixturesEnabled: () => false,
  outageActive: () => false,
  readFixture: () => null,
}));
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

const mockFindNearby = findNearbyHistory as jest.Mock;

function stories(count: number, prefix: string): HistoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    pageId: index + 1,
    title: `${prefix} ${index + 1}`,
    coordinates: { latitude: 52.9, longitude: -0.64 },
    distanceMeters: 100 + index,
    url: `https://en.wikipedia.org/?curid=${index + 1}`,
    source: 'Wikipedia',
  }));
}

// Distinct coords per test: the route's bucket cache is per-module and
// must not leak one test's compose into the next
let lngSeed = -0.6;
function freshRequest(): Request {
  lngSeed -= 0.01;
  return { url: `http://localhost/api/history?lat=52.9089&lng=${lngSeed}` } as Request;
}

describe('shouldWiden', () => {
  test('thin feeds widen, full feeds do not', () => {
    expect(shouldWiden(0)).toBe(true);
    expect(shouldWiden(SparseStoryThreshold - 1)).toBe(true);
    expect(shouldWiden(SparseStoryThreshold)).toBe(false);
    expect(shouldWiden(200)).toBe(false);
  });
});

describe('GET /api/history sparse-area mode', () => {
  beforeEach(() => mockFindNearby.mockReset());

  test('a thin merge re-asks Wikipedia at the wide horizon and flags sparse', async () => {
    mockFindNearby
      .mockResolvedValueOnce(stories(4, 'Village')) // 1500m default
      .mockResolvedValueOnce(stories(40, 'Wider')); // 3000m re-ask

    const response = await GET(freshRequest());
    const body = (await response.json()) as {
      items: HistoryItem[];
      sparse?: boolean;
      horizon?: number;
    };

    expect(mockFindNearby).toHaveBeenCalledTimes(2);
    expect(mockFindNearby.mock.calls[1][1]).toBe(SparseRadiusMeters);
    expect(body.sparse).toBe(true);
    expect(body.horizon).toBe(SparseRadiusMeters);
    expect(body.items).toHaveLength(40);
  });

  test('a dense merge never widens and carries no sparse flag', async () => {
    mockFindNearby.mockResolvedValueOnce(stories(60, 'Greenwich'));

    const response = await GET(freshRequest());
    const body = (await response.json()) as { items: HistoryItem[]; sparse?: boolean };

    expect(mockFindNearby).toHaveBeenCalledTimes(1);
    expect(body.sparse).toBeUndefined();
    expect(body.items).toHaveLength(60);
  });

  test('a failed widening degrades to the narrow list, unflagged', async () => {
    mockFindNearby
      .mockResolvedValueOnce(stories(4, 'Village'))
      .mockRejectedValueOnce(new Error('geosearch down'));

    const response = await GET(freshRequest());
    const body = (await response.json()) as { items: HistoryItem[]; sparse?: boolean };

    expect(response.status).toBe(200);
    expect(body.sparse).toBeUndefined();
    expect(body.items).toHaveLength(4);
  });
});
