import { diskBackedMap } from '@/server/ai-cache';
import { storyParagraphs } from '@/utils/format';

/**
 * The Reader's supply line: the FULL Wikipedia article (we were
 * showing ~3% — the Cutty Sark's intro is 1.2k chars of a 38k-char,
 * 14-chapter article). Fetched by title, parsed into chapters,
 * reference-apparatus culled, cached a week per article.
 */

const UserAgent = 'landmarks-app/1.0 (https://github.com/eddtb/landmarks; learning project)';

export type ArticleChapter = { title: string; paragraphs: string[] };
export type Article = { chapters: ArticleChapter[]; minutes: number };

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
export function parseArticle(text: string): Article {
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

const ArticleTtlMs = 7 * 24 * 60 * 60 * 1000;
const cache = diskBackedMap<{ article: Article; at: number }>('articles');

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

  const article = parseArticle(text);
  cache.set(key, { article, at: Date.now() });
  return article;
}
