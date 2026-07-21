import { diskBackedMap } from '@/server/ai-cache';
import { research } from '@/server/anthropic';
import { getArticle } from '@/server/article';

/**
 * The retold story: the History tab's main event (Edd's call —
 * "the AI content as the main content… long is fine so long as it's
 * organised cleanly"). The free-tier model retells the area's article
 * as titled parts; the untouched original stays one tap away, the AI
 * authorship is labelled at the top, and facts may come only from the
 * source — the same trust contract as the tellings, at length.
 */

export type RetoldPart = { heading: string; body: string };
export type Retold = { parts: RetoldPart[]; minutes: number };

const ReadingWordsPerMinute = 230;
const SourceCharCap = 24000;
const TtlMs = 30 * 24 * 60 * 60 * 1000;
const cache = diskBackedMap<{ retold: Retold; at: number }>('retold');

/** Pure and unit-tested: the contract the model must write to. */
export function retoldPrompt(areaName: string, source: string): string {
  return [
    `You retell local history for a reading app. Retell the story of ${areaName} from the source text below as an engaging long read.`,
    '',
    'Rules:',
    '- Organise it into 6 to 9 parts, each with a short evocative heading (2-5 words) that stays honest to its content.',
    '- Open the first part with the most surprising true thing — the detail a reader would repeat to a friend.',
    '- Short paragraphs (2-4 sentences each), 2-4 paragraphs per part. Aim for 1,200-1,800 words in total. Concrete details, real dates and names. Written to be read with pleasure, not skimmed.',
    '- Chronology should generally flow forward after the opening.',
    '- Use ONLY facts from the source text. Never invent. If the source is thin somewhere, write less.',
    '- Return ONLY fenced JSON: {"parts": [{"heading": "...", "body": "paragraph\\n\\nparagraph"}]}',
    '',
    'Source:',
    source,
  ].join('\n');
}

/** Pure and unit-tested: model text → validated parts, or null. */
export function parseRetold(text: string): Retold | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const parts = (parsed as { parts?: unknown }).parts;
  if (!Array.isArray(parts) || parts.length < 3) {
    return null; // an unorganised retelling is not the product
  }
  const clean: RetoldPart[] = [];
  for (const part of parts) {
    const heading = (part as { heading?: unknown }).heading;
    const body = (part as { body?: unknown }).body;
    if (typeof heading !== 'string' || typeof body !== 'string' || !heading.trim() || !body.trim()) {
      return null;
    }
    clean.push({ heading: heading.trim(), body: body.trim() });
  }
  const words = clean
    .map((part) => part.body)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return { parts: clean, minutes: Math.max(1, Math.round(words / ReadingWordsPerMinute)) };
}

export async function getRetold(areaName: string): Promise<Retold | null> {
  const key = areaName.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TtlMs) {
    return cached.retold;
  }

  const article = await getArticle(areaName);
  if (!article || article.chapters.length === 0) {
    return null;
  }
  const source = article.chapters
    .map((chapter) =>
      chapter.title
        ? `## ${chapter.title}\n${chapter.paragraphs.join('\n')}`
        : chapter.paragraphs.join('\n')
    )
    .join('\n\n')
    .slice(0, SourceCharCap);

  const text = await research({
    prompt: retoldPrompt(areaName, source),
    maxTokens: 4500,
    grounded: false,
    label: `retold:${areaName}`,
  });
  const retold = parseRetold(text);
  if (retold) {
    cache.set(key, { retold, at: Date.now() });
  }
  return retold;
}
