import { ApiError } from '@/data/cached-get';
import { HistoryItem } from '@/types/history';
import { Article } from '@/types/article';
import { Retold } from '@/types/retold';

import { fetchArticle } from '@/data/article-client';
import {
  downloadStatus,
  disableKeepOffline,
  resetDownloadsForTests,
  syncDownloads,
} from '@/data/offline-download';
import {
  keepOfflineEnabled,
  packStory,
  packTelling,
  setPackForTests,
} from '@/data/offline-pack';
import { fetchRetold } from '@/data/retold-client';
import { setSavedForTests } from '@/data/saved';
import { fetchTelling } from '@/data/telling-client';

jest.mock('@/data/article-client', () => ({ fetchArticle: jest.fn() }));
jest.mock('@/data/retold-client', () => ({ fetchRetold: jest.fn() }));
jest.mock('@/data/telling-client', () => ({ fetchTelling: jest.fn() }));
jest.mock('expo-image', () => ({ Image: { prefetch: jest.fn(async () => true) } }));

const mockArticle = fetchArticle as jest.Mock;
const mockRetold = fetchRetold as jest.Mock;
const mockTelling = fetchTelling as jest.Mock;

const item = (pageId: number, title: string, extract?: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract,
  thumbnailUrl: `https://example.com/${pageId}.jpg`,
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
});

const article: Article = {
  chapters: [{ title: '', paragraphs: ['Built in 1717.'] }],
  minutes: 4,
  images: [{ imageUrl: 'https://example.com/hero.jpg', credit: 'Geograph' }],
};

const retold: Retold = {
  parts: [{ heading: 'One', body: 'First.' }],
  minutes: 1,
  timeline: [],
  brief: [],
};

beforeEach(() => {
  resetDownloadsForTests();
  mockArticle.mockReset();
  mockRetold.mockReset();
  mockTelling.mockReset();
  setPackForTests({ enabled: true, stories: {}, tellings: {} });
});

describe('syncDownloads', () => {
  test('a retold place packs article + retelling; a gated place packs its telling', async () => {
    setSavedForTests([
      { item: item(1, 'Palace of Placentia'), savedAt: 2 },
      { item: item(2, 'Spanish Galleon', 'A pub built in 1836.'), savedAt: 1 },
    ]);
    mockArticle.mockResolvedValue(article);
    mockRetold.mockImplementation(async (name: string) => {
      if (name === 'Palace of Placentia') {
        return retold;
      }
      throw new ApiError('Retold', 404); // under the gate
    });
    mockTelling.mockResolvedValue('The pub has watched the street since 1836.');

    await syncDownloads();

    expect(packStory('Palace of Placentia')?.retold?.parts[0].heading).toBe('One');
    expect(packStory('Spanish Galleon')?.retold).toBeNull();
    expect(packTelling(2)).toBe('The pub has watched the street since 1836.');
    expect(packTelling(1)).toBeUndefined();
    expect(downloadStatus(1)).toBe('done');
    expect(downloadStatus(2)).toBe('done');
  });

  test('one place failing entirely does not stop the next', async () => {
    setSavedForTests([
      { item: item(3, 'Wordless Ruin'), savedAt: 2 }, // no extract, everything fails
      { item: item(4, 'Palace of Placentia'), savedAt: 1 },
    ]);
    mockArticle.mockImplementation(async (name: string) => {
      if (name === 'Wordless Ruin') {
        throw new Error('Network request failed');
      }
      return article;
    });
    mockRetold.mockImplementation(async (name: string) => {
      if (name === 'Wordless Ruin') {
        throw new Error('Network request failed');
      }
      return retold;
    });

    await syncDownloads();

    expect(downloadStatus(3)).toBe('failed');
    expect(packStory('Wordless Ruin')).toBeUndefined();
    expect(downloadStatus(4)).toBe('done');
    expect(packStory('Palace of Placentia')).toBeDefined();
  });

  test('a plaque with a subject downloads the SUBJECT story — the key the screens ask with', async () => {
    setSavedForTests([
      {
        item: { ...item(5, 'Deptford Creek plaque', 'First bridged in 1804.'), subject: 'River Ravensbourne' },
        savedAt: 1,
      },
    ]);
    mockArticle.mockResolvedValue(article);
    mockRetold.mockResolvedValue(retold);

    await syncDownloads();

    expect(mockRetold).toHaveBeenCalledWith('River Ravensbourne');
    expect(packStory('River Ravensbourne')).toBeDefined();
  });

  test('un-saved stories leave the pack on the next sync', async () => {
    setPackForTests({
      enabled: true,
      stories: {
        'palace of placentia': { article, retold },
        'gone from the shelf': { article, retold },
      },
      tellings: { '9': 'orphaned telling' },
    });
    setSavedForTests([{ item: item(1, 'Palace of Placentia'), savedAt: 1 }]);

    await syncDownloads();

    expect(packStory('Palace of Placentia')).toBeDefined();
    expect(packStory('Gone From The Shelf')).toBeUndefined();
    expect(packTelling(9)).toBeUndefined();
    // Already packed: marked done without a single new fetch
    expect(downloadStatus(1)).toBe('done');
    expect(mockArticle).not.toHaveBeenCalled();
  });

  test('the toggle off purges statuses with the pack', async () => {
    setSavedForTests([{ item: item(1, 'Palace of Placentia'), savedAt: 1 }]);
    mockArticle.mockResolvedValue(article);
    mockRetold.mockResolvedValue(retold);
    await syncDownloads();
    expect(downloadStatus(1)).toBe('done');

    disableKeepOffline();

    expect(keepOfflineEnabled()).toBe(false);
    expect(downloadStatus(1)).toBeUndefined();
    expect(packStory('Palace of Placentia')).toBeUndefined();
  });
});
