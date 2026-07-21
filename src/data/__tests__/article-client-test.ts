import AsyncStorage from '@react-native-async-storage/async-storage';

const mockFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const savedArticle = {
  chapters: [{ title: 'Origins', paragraphs: ['Built in 1717.'] }],
  minutes: 4,
  images: [{ imageUrl: 'https://example.com/a.jpg', credit: 'Geograph' }],
};

const WeekMs = 7 * 24 * 60 * 60 * 1000;

// Seed "last session's" persisted articles BEFORE the client module
// loads — its cache hydrates at import (relaunch after a force-quit)
const store = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
  .__INTERNAL_MOCK_STORAGE__;
store['cache-article-v1'] = JSON.stringify([
  ['Saved Church', { value: savedArticle, at: Date.now() }],
  ['Expired Church', { value: savedArticle, at: Date.now() - 2 * WeekMs }],
]);

const { fetchArticle, fetchArticleLight } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/data/article-client') as typeof import('@/data/article-client');

describe('fetchArticle persistence', () => {
  beforeEach(() => mockFetch.mockReset());

  test("last session's complete article is served without a fetch", async () => {
    const article = await fetchArticle('Saved Church');
    expect(article.chapters[0].title).toBe('Origins');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('offline, a saved article even past its 7d TTL beats no article', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));
    // 'Expired Church' is past its TTL, so a fetch IS attempted — and
    // when it dies, the saved copy serves rather than nothing
    const article = await fetchArticle('Expired Church');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(article).toEqual(savedArticle);
  });

  test('online, an article past its TTL is re-fetched, not silently served', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ article: { ...savedArticle, minutes: 9 } }),
    });
    // The offline serve above cached nothing — the entry is still expired
    const article = await fetchArticle('Expired Church');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(article.minutes).toBe(9);
  });

  test('offline with nothing saved still throws', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));
    await expect(fetchArticle('Never Seen')).rejects.toThrow('Network request failed');
  });

  test('light articles are never persisted client-side', async () => {
    const light = { chapters: savedArticle.chapters, minutes: 4, images: [] };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ article: light }) });

    await fetchArticleLight('Light Only');
    await fetchArticleLight('Light Only');

    // No client cache for light results: both calls hit the network
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const onDisk = new Map(
      JSON.parse(store['cache-article-v1']) as [string, { value: unknown }][]
    );
    expect(onDisk.has('Light Only')).toBe(false);
  });
});
