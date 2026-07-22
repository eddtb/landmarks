/**
 * The article-existence cascade: the area is named by the first
 * candidate whose area article actually exists — searched name, then
 * district, subregion, city — never by whatever ward the reverse
 * geocoder answers first (the Dorking North bug, device-triaged).
 */
import { renderHook, waitFor } from '@testing-library/react-native';

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

/** Only these titles have an area article; the rest 404. */
function articlesExist(...titles: string[]) {
  mockFetchArticleLight.mockImplementation(async (title: string) => {
    if (titles.includes(title)) {
      return { chapters: [], minutes: 1, images: [] };
    }
    throw new Error('Light article request failed with status 404');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // Module-level stores — start every test unpinned and unresolved
  clearPin();
  resetAreaNameCacheForTests();
  mockReverseGeocodeAsync.mockResolvedValue([
    { district: 'Dorking North', subregion: 'Mole Valley', city: 'Dorking' },
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

  test('unpinned, the ward 404s and falls through — subregion, then city', async () => {
    articlesExist('Dorking');

    const { result } = await renderHook(() => useAreaName(dorking));

    await waitFor(() => expect(result.current).toEqual({ name: 'Dorking', settled: true }));
    // Probed in cascade order until one answered
    expect(mockFetchArticleLight.mock.calls.map((call) => call[0])).toEqual([
      'Dorking North',
      'Mole Valley',
      'Dorking',
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
      'Mole Valley',
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
});
