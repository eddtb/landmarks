/**
 * The article-existence cascade: the area is named by the first
 * candidate whose area article actually exists — searched name, the
 * nearest AREA article Wikipedia knows of, then the geocoder's
 * district, city, and the subregion LAST — never by whatever field the
 * reverse geocoder happens to fill. Apple's `district` is a ward at
 * Dorking ("Dorking North") and a BOROUGH across London ("Bromley"
 * beside Crystal Palace Park); both were device-triaged. The subregion
 * is the county ("Surrey" at Dorking, sim-verified): its article always
 * exists, so anywhere earlier in the order it would beat the town on
 * every GPS walk-through.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

import { ApiError } from '@/data/cached-get';
import { resetAreaNameCacheForTests, useAreaName } from '@/hooks/use-area-name';
import { clearPin, setPin } from '@/hooks/use-pin';

const mockReverseGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: (...args: unknown[]) => mockReverseGeocodeAsync(...args),
}));

const mockFetchArticleLight = jest.fn();
jest.mock('@/data/article-client', () => ({
  fetchArticleLight: (...args: unknown[]) => mockFetchArticleLight(...args),
}));

const mockFetchNearestArea = jest.fn();
jest.mock('@/data/area-client', () => ({
  fetchNearestArea: (...args: unknown[]) => mockFetchNearestArea(...args),
}));

const dorking = { latitude: 51.2325, longitude: -0.3306 };
const crystalPalace = { latitude: 51.4226, longitude: -0.0685 };

/** Only these titles have an area article; the rest 404 for real. */
function articlesExist(...titles: string[]) {
  mockFetchArticleLight.mockImplementation(async (title: string) => {
    if (titles.includes(title)) {
      return { chapters: [], minutes: 1, images: [] };
    }
    throw new ApiError('Light article', 404);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Module-level stores — start every test unpinned and unresolved
  clearPin();
  resetAreaNameCacheForTests();
  // The real geocoder's shape at Dorking: the ward, the county, the town
  mockReverseGeocodeAsync.mockResolvedValue([
    { district: 'Dorking North', subregion: 'Surrey', city: 'Dorking' },
  ]);
  // And Wikipedia's real answer there: nothing nearby is area-classed
  // (probed live — 'area of London' does most of AreaClassIds' work, so
  // outside London this candidate usually abstains). The Dorking cases
  // below are therefore the pre-existing cascade, unchanged.
  mockFetchNearestArea.mockResolvedValue(null);
});

describe('useAreaName (the article-existence cascade)', () => {
  test('the searched name wins when its article exists — the ward is never asked', async () => {
    setPin({ center: dorking, blind: false, label: 'Dorking' });
    articlesExist('Dorking');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Dorking', label: 'Dorking', settled: true })
    );
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);
    expect(mockFetchArticleLight).toHaveBeenCalledWith('Dorking');
  });

  test('unpinned (GPS through Dorking): the ward 404s and the TOWN wins — the county is never probed', async () => {
    // "Surrey" has an article too; the ORDER must keep it from winning
    articlesExist('Dorking', 'Surrey');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Dorking', label: 'Dorking', settled: true })
    );
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Dorking North',
      'Dorking',
    ]);
  });

  test('the county is the last resort: ward and town both 404 before Surrey wins', async () => {
    articlesExist('Surrey');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Surrey', label: 'Surrey', settled: true })
    );
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Dorking North',
      'Dorking',
      'Surrey',
    ]);
  });

  test("a searched name with no article of its own still cascades to the geocoder's", async () => {
    setPin({ center: dorking, blind: false, label: 'dorking east chippy' });
    articlesExist('Dorking North');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() =>
      expect(result.current).toEqual({
        name: 'Dorking North',
        label: 'Dorking North',
        settled: true,
      })
    );
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'dorking east chippy',
      'Dorking North',
    ]);
  });

  test('names but no articles anywhere: the first candidate still names the area', async () => {
    articlesExist(/* nothing */);

    const { result } = await renderHook(() => useAreaName(dorking));

    // The gazetteer will say the story is missing — but the header
    // and the relics keep an honest name
    await waitFor(() =>
      expect(result.current).toEqual({
        name: 'Dorking North',
        label: 'Dorking North',
        settled: true,
      })
    );
  });

  test('no candidates at all (mid-sea): null AND settled — callers can stop waiting', async () => {
    mockReverseGeocodeAsync.mockResolvedValue([]);

    const { result } = await renderHook(() =>
      useAreaName({ latitude: 48.8767, longitude: -12.4149 })
    );

    await waitFor(() =>
      expect(result.current).toEqual({ name: null, label: null, settled: true })
    );
    expect(mockFetchArticleLight).not.toHaveBeenCalled();
  });

  test('one cascade per area: a second consumer joins the first resolution', async () => {
    articlesExist('Dorking');

    const first = await renderHook(() => useAreaName(dorking));
    const second = await renderHook(() => useAreaName(dorking));

    await waitFor(() => expect(first.result.current.settled).toBe(true));
    await waitFor(() => expect(second.result.current.settled).toBe(true));
    // Both tabs agree on the winner, off ONE set of probes
    expect(first.result.current.name).toBe('Dorking');
    expect(second.result.current.name).toBe('Dorking');
    expect(mockReverseGeocodeAsync).toHaveBeenCalledTimes(1);
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Dorking North',
      'Dorking',
    ]);
  });

  test("the searched name only counts at its own pin's bucket", async () => {
    // Pinned Dorking earlier; now the hook asks about somewhere else
    setPin({ center: dorking, blind: false, label: 'Dorking' });
    mockReverseGeocodeAsync.mockResolvedValue([{ city: 'Greenwich' }]);
    articlesExist('Greenwich');

    const { result } = await renderHook(() =>
      useAreaName({ latitude: 51.4826, longitude: -0.0077 })
    );

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Greenwich', label: 'Greenwich', settled: true })
    );
    expect(mockFetchArticleLight).not.toHaveBeenCalledWith('Dorking');
  });

  test('a 500 on the first candidate does not hand the win to the second — and is never cached', async () => {
    // The server hiccups on the ward's probe; "Dorking" would answer
    mockFetchArticleLight.mockImplementation(async (title: string) => {
      if (title === 'Dorking North') {
        throw new ApiError('Light article', 500);
      }
      if (title === 'Dorking') {
        return { chapters: [], minutes: 1, images: [] };
      }
      throw new ApiError('Light article', 404);
    });

    const flaky = await renderHook(() => useAreaName(dorking));

    // Inconclusive is not "missing": the ward keeps the name
    // provisionally — no later candidate is crowned off a hiccup
    await waitFor(() =>
      expect(flaky.result.current).toEqual({
        name: 'Dorking North',
        label: 'Dorking North',
        settled: true,
      })
    );
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);

    // The hiccup passes; a fresh consumer re-runs the cascade (a
    // provisional verdict earned no bucket-lifetime cache) and the
    // now-definite 404 falls through to the town
    articlesExist('Dorking');
    const recovered = await renderHook(() => useAreaName(dorking));
    await waitFor(() =>
      expect(recovered.result.current).toEqual({ name: 'Dorking', label: 'Dorking', settled: true })
    );
  });

  test('fully offline: the first candidate names the area provisionally, uncached', async () => {
    mockFetchArticleLight.mockRejectedValue(new TypeError('Network request failed'));

    const offline = await renderHook(() => useAreaName(dorking));
    await waitFor(() =>
      expect(offline.result.current).toEqual({
        name: 'Dorking North',
        label: 'Dorking North',
        settled: true,
      })
    );
    // Only the first candidate was probed — an inconclusive answer
    // stops the cascade instead of skipping to a wrong winner
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);

    // Back online, the cascade re-resolves to the real winner
    articlesExist('Dorking');
    const online = await renderHook(() => useAreaName(dorking));
    await waitFor(() =>
      expect(online.result.current).toEqual({ name: 'Dorking', label: 'Dorking', settled: true })
    );
  });
});

/**
 * The borough bug, device-triaged beside Crystal Palace Park: the
 * landmarks were right and the header said "Bromley". CoreLocation was
 * probed directly at these coordinates and answers subLocality
 * "Bromley", locality "London", subAdministrativeArea "London" — so
 * the old cascade crowned a town four miles away on its FIRST probe,
 * because unlike a ward, a borough's article exists.
 */
describe('useAreaName beside Crystal Palace Park (the borough bug)', () => {
  beforeEach(() => {
    // CoreLocation's real answer at 51.4226, -0.0685
    mockReverseGeocodeAsync.mockResolvedValue([
      { district: 'Bromley', city: 'London', subregion: 'London', region: 'England' },
    ]);
    // Wikipedia's nearest area-classed article: 290m away, live-probed
    mockFetchNearestArea.mockResolvedValue('Crystal Palace, London');
  });

  test('the nearest AREA wins over the borough — whose article exists too', async () => {
    articlesExist('Crystal Palace, London', 'Bromley', 'London');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() =>
      expect(result.current).toEqual({
        name: 'Crystal Palace, London',
        label: 'Crystal Palace',
        settled: true,
      })
    );
    // The borough is never even asked: the article that exists at the
    // wrong place is the whole danger here
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Crystal Palace, London',
    ]);
  });

  test('the label drops the disambiguator, the name keeps it for fetching', async () => {
    articlesExist('Crystal Palace, London');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() => expect(result.current.settled).toBe(true));
    // Bare "Crystal Palace" is the glass building's article, so the
    // gazetteer must keep fetching by the disambiguated title
    expect(result.current.name).toBe('Crystal Palace, London');
    expect(result.current.label).toBe('Crystal Palace');
  });

  test('a name the geocoder does not contain keeps its comma', async () => {
    // Only containers the geocoder actually named are trimmed
    mockFetchNearestArea.mockResolvedValue('Sydenham, Oxfordshire');
    articlesExist('Sydenham, Oxfordshire');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() => expect(result.current.settled).toBe(true));
    expect(result.current.label).toBe('Sydenham, Oxfordshire');
  });

  test('a name that IS its own container is never trimmed to nothing', async () => {
    mockFetchNearestArea.mockResolvedValue('London');
    articlesExist('London');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'London', label: 'London', settled: true })
    );
  });

  test('the searched name still outranks the nearest area', async () => {
    setPin({ center: crystalPalace, blind: false, label: 'Penge' });
    articlesExist('Penge', 'Crystal Palace, London');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Penge', label: 'Penge', settled: true })
    );
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);
  });

  test('a failed area lookup falls through to the borough — but is NEVER cached', async () => {
    // A rate-limited minute must not pin "Bromley" to this bucket for
    // as long as the user stands in it: couldn't-ask is not no-area
    mockFetchNearestArea.mockRejectedValue(new Error('Area name request failed with status 502'));
    articlesExist('Bromley', 'Crystal Palace, London');

    const failed = await renderHook(() => useAreaName(crystalPalace));
    await waitFor(() =>
      expect(failed.result.current).toEqual({ name: 'Bromley', label: 'Bromley', settled: true })
    );

    // The lookup recovers; a fresh consumer re-runs the cascade because
    // the borough's win was provisional, and Wikipedia's answer lands
    mockFetchNearestArea.mockResolvedValue('Crystal Palace, London');
    const recovered = await renderHook(() => useAreaName(crystalPalace));
    await waitFor(() =>
      expect(recovered.result.current).toEqual({
        name: 'Crystal Palace, London',
        label: 'Crystal Palace',
        settled: true,
      })
    );
  });

  test('no area article nearby is a real verdict: the cascade proceeds and caches', async () => {
    mockFetchNearestArea.mockResolvedValue(null);
    articlesExist('Bromley');

    const { result } = await renderHook(() => useAreaName(crystalPalace));

    await waitFor(() =>
      expect(result.current).toEqual({ name: 'Bromley', label: 'Bromley', settled: true })
    );
    // Settled for the bucket's lifetime — a second consumer re-probes
    // nothing (contrast the failure case above)
    const second = await renderHook(() => useAreaName(crystalPalace));
    await waitFor(() => expect(second.result.current.settled).toBe(true));
    expect(mockFetchNearestArea).toHaveBeenCalledTimes(1);
  });
});
