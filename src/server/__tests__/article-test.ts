import { diskBackedMap } from '@/server/ai-cache';
import { getArticle, getArticleLight, parseArticle, pickImageFiles } from '@/server/article';
import { wikiTitleFromUrl } from '@/utils/format';

// Shaped like the real thing: the Cutty Sark article's structure,
// condensed (== wiki headings ==, junk tail, an empty section)
const FullText = [
  'Cutty Sark (/ˌkʌti ˈsɑːrk/) is a British clipper ship. Built in 1869.',
  '',
  '== Construction ==',
  'Willis chose Hercules Linton to design and build the ship. The contract price was £17 per ton.',
  '== History ==',
  'The ship was destined for the tea trade.',
  '=== First tea seasons ===',
  'She left London on 16 February 1870 and arrived in Shanghai on 31 May.',
  '=== As Ferreira ===',
  'Sold to the Portuguese firm Ferreira and Co. in 1895.',
  '== Legacy ==', // empty: prose lived in templates
  '== See also ==',
  'List of large sailing vessels',
  '== References ==',
  'Citation one. Citation two.',
  '=== Sources ===',
  'A junk subsection that must go with its parent.',
  '== Bibliography ==',
  'Book, Some. A History.',
].join('\n');

describe('parseArticle', () => {
  const article = parseArticle(FullText);

  test('keeps the prose chapters, in order, with subsections named by their parent', () => {
    expect(article.chapters.map((chapter) => chapter.title)).toEqual([
      '', // the intro
      'Construction',
      'History',
      'History · First tea seasons',
      'History · As Ferreira',
    ]);
  });

  test('culls the reference apparatus AND its subsections, and empty chapters', () => {
    const titles = article.chapters.map((chapter) => chapter.title).join('|');
    expect(titles).not.toMatch(/References|See also|Bibliography|Sources|Legacy/);
  });

  test('paragraphs are cleaned like everywhere else (IPA stripped)', () => {
    expect(article.chapters[0].paragraphs[0]).toBe(
      'Cutty Sark is a British clipper ship. Built in 1869.'
    );
  });

  test('reading time has a one-minute floor', () => {
    expect(article.minutes).toBe(1);
    expect(parseArticle(`${'word '.repeat(2300)}.`).minutes).toBe(10);
  });
});

describe('pickImageFiles', () => {
  test('photographs in, reading furniture out — from the real media-list', () => {
    expect(
      pickImageFiles([
        'File:Old_Royal_Naval_College_2017-08-06.jpg',
        'File:Greenwich_UK_locator_map.svg',
        'File:Royal_Borough_of_Greenwich_coat_of_arms.png',
        'File:Greenwich_Market_-_London.jpg',
        'File:Commons-logo.svg',
        'File:Greenwich_Market_-_London.jpg', // dupe
      ])
    ).toEqual(['File:Old_Royal_Naval_College_2017-08-06.jpg', 'File:Greenwich_Market_-_London.jpg']);
  });

  test('caps the haul', () => {
    const many = Array.from({ length: 20 }, (_, i) => `File:Photo_${i}.jpg`);
    expect(pickImageFiles(many)).toHaveLength(8);
  });
});

/**
 * The chapters-first split, measured cold at 1.3-1.7s of which ~1.2s
 * was the two image legs serialized AFTER the 0.2s extract leg that
 * already carries everything first paint needs.
 */
describe('getArticleLight / getArticle (the chapters-first split)', () => {
  const ExtractBody = { query: { pages: { '1': { extract: FullText } } } };
  const MediaBody = {
    items: [{ type: 'image', title: 'File:Cutty_Sark_2012.jpg', srcset: [{}] }],
  };
  const InfoBody = {
    query: {
      pages: {
        '1': {
          title: 'File:Cutty Sark 2012.jpg',
          imageinfo: [{ thumburl: 'https://upload.example/800px-Cutty_Sark_2012.jpg' }],
        },
      },
    },
  };

  // No node types in the app tsconfig — reach fetch through a cast
  const globalWithFetch = globalThis as { fetch: unknown };
  const realFetch = globalWithFetch.fetch;
  const fetchMock = jest.fn(async (url: unknown) => {
    const target = String(url);
    const body = target.includes('media-list')
      ? MediaBody
      : target.includes('commons.wikimedia.org')
        ? InfoBody
        : ExtractBody;
    return { ok: true, json: async () => body } as Response;
  });
  const legCalls = (part: string) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes(part)).length;

  beforeEach(() => {
    globalWithFetch.fetch = fetchMock;
    fetchMock.mockClear();
    // Same live instances the module holds — start each test cold
    diskBackedMap('articles-v2').clear();
    diskBackedMap('articles-light-v1').clear();
  });

  afterAll(() => {
    globalWithFetch.fetch = realFetch;
  });

  test('light serves chapters off the extract leg alone — no image legs', async () => {
    const article = await getArticleLight('Cutty Sark');
    expect(article?.chapters.length).toBeGreaterThan(0);
    expect(article?.minutes).toBe(1);
    expect(article?.images).toEqual([]);
    expect(legCalls('prop=extracts')).toBe(1);
    expect(legCalls('media-list')).toBe(0);
    expect(legCalls('commons.wikimedia.org')).toBe(0);
  });

  test('a light result never poisons the full cache: images still arrive', async () => {
    await getArticleLight('Cutty Sark');
    const full = await getArticle('Cutty Sark');
    // The gallery legs ran and landed — an empty light gallery cached
    // as the full article would have hidden them for a week
    expect(full?.images).toEqual([
      expect.objectContaining({ imageUrl: 'https://upload.example/800px-Cutty_Sark_2012.jpg' }),
    ]);
    expect(legCalls('media-list')).toBe(1);
    // ...and the full path reused the light entry's extract leg
    expect(legCalls('prop=extracts')).toBe(1);
  });

  test('the complete cache is preferred: light then returns images, zero fetches', async () => {
    const full = await getArticle('Cutty Sark');
    fetchMock.mockClear();
    const light = await getArticleLight('Cutty Sark');
    expect(light).toBe(full);
    expect(light?.images).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('single-flight: concurrent cold opens share one upstream fetch', async () => {
    const [a, b] = await Promise.all([getArticle('Cutty Sark'), getArticle('Cutty Sark')]);
    expect(a).toBe(b);
    expect(legCalls('prop=extracts')).toBe(1);
    expect(legCalls('media-list')).toBe(1);
    expect(legCalls('commons.wikimedia.org')).toBe(1);
  });

  test('light concurrent opens single-flight too', async () => {
    await Promise.all([getArticleLight('Cutty Sark'), getArticleLight('Cutty Sark')]);
    expect(legCalls('prop=extracts')).toBe(1);
  });
});

describe('wikiTitleFromUrl', () => {
  test('decodes the article title from the url', () => {
    expect(wikiTitleFromUrl('https://en.wikipedia.org/wiki/Cutty_Sark')).toBe('Cutty Sark');
    expect(wikiTitleFromUrl('https://en.wikipedia.org/wiki/Queen%27s_House')).toBe(
      "Queen's House"
    );
  });

  test('non-wikipedia urls get no door', () => {
    expect(wikiTitleFromUrl('https://openplaques.org/plaques/5292')).toBeNull();
    expect(
      wikiTitleFromUrl('https://historicengland.org.uk/listing/the-list/list-entry/1079013')
    ).toBeNull();
  });
});
