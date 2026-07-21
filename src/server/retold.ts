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

export type RetoldPart = { heading: string; body: string; pullQuote?: string };
export type TimelineStop = { year: string; label: string; part: number };
export type Retold = { parts: RetoldPart[]; minutes: number; timeline: TimelineStop[] };

const ReadingWordsPerMinute = 230;
const SourceCharCap = 24000;
const TtlMs = 30 * 24 * 60 * 60 * 1000;
// v2: v1 entries predate pull-quotes and the timeline
const cache = diskBackedMap<{ retold: Retold; at: number }>('retold-v2');

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
    '- For each part you MAY include "pullQuote": ONE sentence copied EXACTLY, word for word, from that part\'s body — its most repeatable line. Omit it where nothing stands out.',
    '- Include a top-level "timeline": 4 to 6 pivotal dated moments, each {"year": "1491", "label": "Henry VIII born here", "part": 4} — label 3-6 words, facts only from the source, "part" = the 1-based number of the part where that moment is told.',
    '- Return ONLY fenced JSON: {"parts": [{"heading": "...", "body": "paragraph\\n\\nparagraph", "pullQuote": "..."}], "timeline": [...]}',
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
  // Verbatim-in-spirit: punctuation cosmetics (curly quotes, commas,
  // case) may drift; the WORDS may not — invented sentences still die
  const squash = (text: string) =>
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const part of parts) {
    const heading = (part as { heading?: unknown }).heading;
    const body = (part as { body?: unknown }).body;
    if (typeof heading !== 'string' || typeof body !== 'string' || !heading.trim() || !body.trim()) {
      return null;
    }
    // A pull-quote may only be a sentence the part actually contains —
    // an invented one is dropped, never rendered
    const rawQuote = (part as { pullQuote?: unknown }).pullQuote;
    const pullQuote =
      typeof rawQuote === 'string' && rawQuote.trim() && squash(body).includes(squash(rawQuote))
        ? rawQuote.trim()
        : undefined;
    clean.push({ heading: heading.trim(), body: body.trim(), pullQuote });
  }

  // Timeline stops must be dated, brief, and anchored to a real part
  const rawTimeline = (parsed as { timeline?: unknown }).timeline;
  const timeline: TimelineStop[] = (Array.isArray(rawTimeline) ? rawTimeline : [])
    .flatMap((stop) => {
      const year = (stop as { year?: unknown }).year;
      const label = (stop as { label?: unknown }).label;
      const part = (stop as { part?: unknown }).part;
      if (
        typeof year !== 'string' ||
        !/^\d{3,4}s?$/.test(year.trim()) ||
        typeof label !== 'string' ||
        !label.trim() ||
        label.trim().length > 48 ||
        typeof part !== 'number' ||
        !Number.isInteger(part) ||
        part < 1 ||
        part > clean.length
      ) {
        return [];
      }
      return [{ year: year.trim(), label: label.trim(), part }];
    })
    .slice(0, 6);

  const words = clean
    .map((part) => part.body)
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return { parts: clean, minutes: Math.max(1, Math.round(words / ReadingWordsPerMinute)), timeline };
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
