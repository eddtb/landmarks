import { parseArticle } from '@/server/article';
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
