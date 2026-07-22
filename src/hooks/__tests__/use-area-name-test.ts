/**
 * The article-existence cascade: the area is named by the first
 * candidate whose area article actually exists — searched name, then
 * district, city, and the subregion LAST — never by whatever ward the
 * reverse geocoder answers first (the Dorking North bug,
 * device-triaged). The subregion is the county ("Surrey" at Dorking,
 * sim-verified): its article always exists, so anywhere earlier in
 * the order it would beat the town on every GPS walk-through.
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

const dorking = { latitude: 51.2325, longitude: -0.3306 };

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
});

describe('useAreaName (the article-existence cascade)', () => {
  test('the searched name wins when its article exists — the ward is never asked', async () => {
    setPin({ center: dorking, blind: false, label: 'Dorking' });
    articlesExist('Dorking');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() => expect(result.current).toEqual({ name: 'Dorking', settled: true }));
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);
    expect(mockFetchArticleLight).toHaveBeenCalledWith('Dorking');
  });

  test('unpinned (GPS through Dorking): the ward 404s and the TOWN wins — the county is never probed', async () => {
    // "Surrey" has an article too; the ORDER must keep it from winning
    articlesExist('Dorking', 'Surrey');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() => expect(result.current).toEqual({ name: 'Dorking', settled: true }));
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Dorking North',
      'Dorking',
    ]);
  });

  test('the county is the last resort: ward and town both 404 before Surrey wins', async () => {
    articlesExist('Surrey');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() => expect(result.current).toEqual({ name: 'Surrey', settled: true }));
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

    await waitFor(() => expect(result.current).toEqual({ name: 'Dorking North', settled: true }));
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
    await waitFor(() => expect(result.current).toEqual({ name: 'Dorking North', settled: true }));
  });

  test('no candidates at all (mid-sea): null AND settled — callers can stop waiting', async () => {
    mockReverseGeocodeAsync.mockResolvedValue([]);

    const { result } = await renderHook(() =>
      useAreaName({ latitude: 48.8767, longitude: -12.4149 })
    );

    await waitFor(() => expect(result.current).toEqual({ name: null, settled: true }));
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

    await waitFor(() => expect(result.current).toEqual({ name: 'Greenwich', settled: true }));
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
      expect(flaky.result.current).toEqual({ name: 'Dorking North', settled: true })
    );
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);

    // The hiccup passes; a fresh consumer re-runs the cascade (a
    // provisional verdict earned no bucket-lifetime cache) and the
    // now-definite 404 falls through to the town
    articlesExist('Dorking');
    const recovered = await renderHook(() => useAreaName(dorking));
    await waitFor(() =>
      expect(recovered.result.current).toEqual({ name: 'Dorking', settled: true })
    );
  });

  test('fully offline: the first candidate names the area provisionally, uncached', async () => {
    mockFetchArticleLight.mockRejectedValue(new TypeError('Network request failed'));

    const offline = await renderHook(() => useAreaName(dorking));
    await waitFor(() =>
      expect(offline.result.current).toEqual({ name: 'Dorking North', settled: true })
    );
    // Only the first candidate was probed — an inconclusive answer
    // stops the cascade instead of skipping to a wrong winner
    expect(mockFetchArticleLight).toHaveBeenCalledTimes(1);

    // Back online, the cascade re-resolves to the real winner
    articlesExist('Dorking');
    const online = await renderHook(() => useAreaName(dorking));
    await waitFor(() => expect(online.result.current).toEqual({ name: 'Dorking', settled: true }));
  });
});
