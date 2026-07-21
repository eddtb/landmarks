import { diskBackedMap } from '@/server/ai-cache';
import { CommonsPage, creditLine } from '@/server/commons';
import { storyParagraphs } from '@/utils/format';

/**
 * The Reader's supply line: the FULL Wikipedia article (we were
 * showing ~3% — the Cutty Sark's intro is 1.2k chars of a 38k-char,
 * 14-chapter article). Fetched by title, parsed into chapters,
 * reference-apparatus culled, cached a week per article.
 */

const UserAgent = 'landmarks-app/1.0 (https://github.com/eddtb/landmarks; learning project)';

export type ArticleChapter = { title: string; paragraphs: string[] };
export type ArticleImage = { imageUrl: string; credit: string };
export type Article = { chapters: ArticleChapter[]; minutes: number; images: ArticleImage[] };

// The reference apparatus reads as junk in a reading app
const JunkSections = new Set([
  'references',
  'external links',
  'see also',
  'further reading',
  'notes',
  'bibliography',
  'sources',
  'footnotes',
  'citations',
  'works cited',
  'gallery',
]);

const ReadingWordsPerMinute = 230;

/** Pure and unit-tested: wiki-format plaintext → chapters. */
export function parseArticle(text: string): Omit<Article, 'images'> {
  const blocks: { title: string; depth: number; lines: string[] }[] = [
    { title: '', depth: 2, lines: [] },
  ];
  for (const line of text.split('\n')) {
    const heading = line.match(/^(={2,})\s*(.+?)\s*=+\s*$/);
    if (heading) {
      blocks.push({ title: heading[2], depth: heading[1].length, lines: [] });
    } else {
      blocks[blocks.length - 1].lines.push(line);
    }
  }

  const chapters: ArticleChapter[] = [];
  let parentTitle = '';
  let skippingBelow: number | null = null;
  for (const block of blocks) {
    if (skippingBelow !== null && block.depth > skippingBelow) {
      continue; // a junk section takes its subsections with it
    }
    skippingBelow = null;
    if (JunkSections.has(block.title.toLowerCase())) {
      skippingBelow = block.depth;
      continue;
    }
    if (block.depth === 2) {
      parentTitle = block.title;
    }
    const paragraphs = storyParagraphs(block.lines.join('\n'));
    if (paragraphs.length === 0) {
      continue; // headings whose prose lived in templates arrive empty
    }
    const title =
      block.depth > 2 && parentTitle && parentTitle !== block.title
        ? `${parentTitle} · ${block.title}`
        : block.title;
    chapters.push({ title, paragraphs });
  }

  const words = chapters
    .flatMap((chapter) => chapter.paragraphs)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

  return { chapters, minutes: Math.max(1, Math.round(words / ReadingWordsPerMinute)) };
}

/**
 * The article's OWN illustrations — never guessed, so a station can't
 * moonlight as a theatre here. media-list gives the files; one batched
 * Commons lookup gives 800px renditions and honest credits. Diagrams,
 * maps, flags and heraldry are reading furniture, not photographs.
 */
const NoiseFilePattern = /\.svg$|\bmaps?\b|logo|icon|flag|coat[_ ]of[_ ]arms|locator|banner|montage/i;

export function pickImageFiles(titles: string[], limit = 8): string[] {
  const picked: string[] = [];
  for (const title of titles) {
    if (!NoiseFilePattern.test(title) && !picked.includes(title)) {
      picked.push(title);
    }
    if (picked.length >= limit) {
      break;
    }
  }
  return picked;
}

async function fetchArticleImages(title: string): Promise<ArticleImage[]> {
  const mediaResponse = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`,
    { headers: { 'User-Agent': UserAgent }, signal: AbortSignal.timeout(5000) }
  );
  if (!mediaResponse.ok) {
    return [];
  }
  const media = (await mediaResponse.json()) as {
    items?: { type?: string; title?: string; srcset?: unknown[] }[];
  };
  const files = pickImageFiles(
    (media.items ?? [])
      .filter((item) => item.type === 'image' && item.srcset?.length && item.title)
      .map((item) => item.title!)
  );
  if (files.length === 0) {
    return [];
  }

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: files.join('|'),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata',
    iiurlwidth: '800',
  });
  const infoResponse = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UserAgent },
    signal: AbortSignal.timeout(5000),
  });
  if (!infoResponse.ok) {
    return [];
  }
  const info = (await infoResponse.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  // Preserve the article's own ordering — the lead image leads. The
  // API normalises underscores to spaces in response titles; match
  // both sides normalised or every lookup silently misses.
  const normalise = (title: string) => title.replace(/_/g, ' ');
  const byTitle = new Map(
    Object.values(info.query?.pages ?? {}).map((page) => [normalise(page.title ?? ''), page])
  );
  return files.flatMap((file) => {
    const page = byTitle.get(normalise(file));
    const thumburl = page?.imageinfo?.[0]?.thumburl;
    return page && thumburl ? [{ imageUrl: thumburl, credit: creditLine(page) }] : [];
  });
}

const ArticleTtlMs = 7 * 24 * 60 * 60 * 1000;
// v2: v1 entries predate images and would serve without them for a week
const cache = diskBackedMap<{ article: Article; at: number }>('articles-v2');

export async function getArticle(title: string): Promise<Article | null> {
  const key = title.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < ArticleTtlMs) {
    return cached.article;
  }

  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: title,
    redirects: '1',
    prop: 'extracts',
    explaintext: '1',
    exsectionformat: 'wiki',
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UserAgent },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    throw new Error(`Wikipedia extract failed with status ${response.status}`);
  }
  const body = (await response.json()) as {
    query?: { pages?: Record<string, { extract?: string }> };
  };
  const text = Object.values(body.query?.pages ?? {})[0]?.extract;
  if (!text) {
    return null;
  }

  const images = await fetchArticleImages(title).catch(() => []);
  const article = { ...parseArticle(text), images };
  cache.set(key, { article, at: Date.now() });
  return article;
}
