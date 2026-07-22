import { diskBackedMap } from '@/server/ai-cache';
import { researchStream } from '@/server/anthropic';
import { getArticle } from '@/server/article';
import { extractAnswerText } from '@/server/gemini';
import { Retold, RetoldPart, TimelineStop } from '@/types/retold';

/**
 * The retold story: the History tab's main event (Edd's call —
 * "the AI content as the main content… long is fine so long as it's
 * organised cleanly"). The free-tier model retells the area's article
 * as titled parts; the untouched original stays one tap away, the AI
 * authorship is labelled at the top, and facts may come only from the
 * source — the same trust contract as the tellings, at length.
 */

const ReadingWordsPerMinute = 230;
const SourceCharCap = 24000;
const TtlMs = 30 * 24 * 60 * 60 * 1000;
// A failed or refused retelling is remembered too — every open must
// NOT re-burn a free-tier call on an article that can't be retold
const NoRetellTtlMs = 7 * 24 * 60 * 60 * 1000;
// Stubs don't earn a retelling: their formatted original already
// reads well, and the call quota goes where the stories are rich
export const MinSourceChars = 3000;
// v2: v1 entries predate pull-quotes and the timeline
const cache = diskBackedMap<{ retold: Retold | null; at: number }>('retold-v2');
const inFlight = new Map<string, Promise<Retold | null>>();

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

// Verbatim-in-spirit: punctuation cosmetics (curly quotes, commas,
// case) may drift; the WORDS may not — invented sentences still die
const squash = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Pure and unit-tested: one raw model part → a clean RetoldPart, or
 * null when it isn't one. Shared by the whole-text parse and the
 * incremental scanner, so a part streamed live is byte-identical to
 * the same part in the finished, cached telling.
 */
export function cleanRetoldPart(raw: unknown): RetoldPart | null {
  const heading = (raw as { heading?: unknown }).heading;
  const body = (raw as { body?: unknown }).body;
  if (typeof heading !== 'string' || typeof body !== 'string' || !heading.trim() || !body.trim()) {
    return null;
  }
  // A pull-quote may only be a sentence the part actually contains —
  // an invented one is dropped, never rendered
  const rawQuote = (raw as { pullQuote?: unknown }).pullQuote;
  const pullQuote =
    typeof rawQuote === 'string' && rawQuote.trim() && squash(body).includes(squash(rawQuote))
      ? rawQuote.trim()
      : undefined;
  return { heading: heading.trim(), body: body.trim(), pullQuote };
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
    const cleaned = cleanRetoldPart(part);
    if (!cleaned) {
      return null;
    }
    clean.push(cleaned);
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

/**
 * Incremental part scanner: consumes the model's output as a growing
 * buffer and returns each COMPLETE part the moment its closing brace
 * lands — a half-written paragraph is never surfaced. Parts are
 * cleaned by the same rules as parseRetold, so what streams live is
 * what the finished telling will hold. An unparseable object here
 * poisons nothing: the scanner only feeds the live render, and the
 * end-of-stream parseRetold stays the one verdict.
 */
export function makePartScanner(): { feed(chunk: string): RetoldPart[] } {
  let buffer = '';
  let phase: 'seeking' | 'array' | 'done' = 'seeking';
  let pos = 0; // next unscanned index — feeds resume, never re-scan
  let depth = 0;
  let inString = false;
  let escaped = false;
  let objectStart = -1;

  return {
    feed(chunk: string): RetoldPart[] {
      if (phase === 'done') {
        return [];
      }
      buffer += chunk;
      if (phase === 'seeking') {
        const opened = buffer.match(/"parts"\s*:\s*\[/);
        if (!opened || opened.index === undefined) {
          return [];
        }
        buffer = buffer.slice(opened.index + opened[0].length);
        pos = 0;
        phase = 'array';
      }
      const parts: RetoldPart[] = [];
      while (pos < buffer.length) {
        const char = buffer[pos];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === '\\') {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
        } else if (char === '"') {
          inString = true;
        } else if (char === '{') {
          if (depth === 0) {
            objectStart = pos;
          }
          depth += 1;
        } else if (char === '}') {
          depth -= 1;
          if (depth === 0 && objectStart >= 0) {
            let raw: unknown = null;
            try {
              raw = JSON.parse(buffer.slice(objectStart, pos + 1));
            } catch {
              // not a part; the final parse is the verdict
            }
            const part = raw === null ? null : cleanRetoldPart(raw);
            if (part) {
              parts.push(part);
            }
            buffer = buffer.slice(pos + 1);
            pos = -1; // the increment below restarts at 0
            objectStart = -1;
          }
        } else if (char === ']' && depth === 0) {
          phase = 'done'; // the timeline that follows is end-of-stream business
          break;
        }
        pos += 1;
      }
      return parts;
    },
  };
}

export type RetoldStreamEvent =
  | { kind: 'part'; index: number; part: RetoldPart }
  | { kind: 'done'; retold: Retold }
  | { kind: 'failed'; reason: 'interrupted' | 'invalid' };

export type RetoldStreamStart =
  | { kind: 'unavailable' } // no article, or too thin to retell — a 404
  | { kind: 'join' } // a generation is already running — share it as JSON
  | { kind: 'stream'; events: AsyncGenerator<RetoldStreamEvent, void, void> };

/** The fresh cache entry (a null retold is the "no retelling" verdict), or undefined. */
export function peekRetold(areaName: string): { retold: Retold | null } | undefined {
  const cached = cache.get(areaName.toLowerCase());
  if (cached && Date.now() - cached.at < (cached.retold ? TtlMs : NoRetellTtlMs)) {
    return { retold: cached.retold };
  }
  return undefined;
}

export function retellingInFlight(areaName: string): boolean {
  return inFlight.has(areaName.toLowerCase());
}

async function retellSource(areaName: string): Promise<string | null> {
  const article = await getArticle(areaName);
  if (!article || article.chapters.length === 0) {
    return null;
  }
  return article.chapters
    .map((chapter) =>
      chapter.title
        ? `## ${chapter.title}\n${chapter.paragraphs.join('\n')}`
        : chapter.paragraphs.join('\n')
    )
    .join('\n\n')
    .slice(0, SourceCharCap);
}

/**
 * Open a COLD generation as a stream of complete parts. Callers check
 * peekRetold first — this is the one call site's transport, not a
 * second call site. The budget breaker (and REPLAY_ONLY) gate the
 * stream exactly as they gated the one-shot call: the first delta is
 * pulled HERE, so a refused call throws before any stream is offered
 * and nothing is cached — we couldn't try, so we may try again.
 */
export async function startRetoldStream(areaName: string): Promise<RetoldStreamStart> {
  const key = areaName.toLowerCase();
  // Single-flight: concurrent opens of the same story share one call
  if (inFlight.has(key)) {
    return { kind: 'join' };
  }
  let settle!: (retold: Retold | null) => void;
  const shared = new Promise<Retold | null>((resolve) => {
    settle = resolve;
  });
  inFlight.set(key, shared);
  const finish = (retold: Retold | null) => {
    inFlight.delete(key);
    settle(retold);
  };

  try {
    const source = await retellSource(areaName);
    if (source === null) {
      // No article at all: not cached — the article may yet appear
      finish(null);
      return { kind: 'unavailable' };
    }
    if (source.length < MinSourceChars) {
      // Stubs don't earn a retelling — not worth a call now, or on the next open
      cache.set(key, { retold: null, at: Date.now() });
      finish(null);
      return { kind: 'unavailable' };
    }
    const deltas = researchStream({
      prompt: retoldPrompt(areaName, source),
      maxTokens: 4500,
      grounded: false,
      label: `retold:${areaName}`,
    });
    const first = await deltas.next(); // breaker + connection open happen here
    return { kind: 'stream', events: pumpRetold(key, deltas, first, finish) };
  } catch (error) {
    finish(null);
    throw error;
  }
}

async function* pumpRetold(
  key: string,
  deltas: AsyncGenerator<string, void, void>,
  first: IteratorResult<string, void>,
  finish: (retold: Retold | null) => void
): AsyncGenerator<RetoldStreamEvent, void, void> {
  const scanner = makePartScanner();
  let raw = '';
  let index = 0;
  let settled = false;
  const take = (delta: string): RetoldStreamEvent[] => {
    raw += delta;
    return scanner.feed(delta).map((part) => ({ kind: 'part' as const, index: index++, part }));
  };

  try {
    try {
      if (!first.done) {
        for (const event of take(first.value)) {
          yield event;
        }
        while (true) {
          const next = await deltas.next();
          if (next.done) {
            break;
          }
          for (const event of take(next.value)) {
            yield event;
          }
        }
      }
    } catch (error) {
      // The stream broke mid-write. Couldn't-finish is not a verdict:
      // NOTHING is cached, and the next ask may try again.
      console.error('Retold stream interrupted:', error);
      finish(null);
      settled = true;
      yield { kind: 'failed', reason: 'interrupted' };
      return;
    }

    // The model finished writing: the whole-text parse is the verdict,
    // with exactly the one-shot path's caching — a valid telling for
    // 30 days; a completed-but-invalid one as the 7-day "no retelling"
    // verdict (the call was spent; re-spending per open compounds it).
    const retold = parseRetold(extractAnswerText([{ text: raw }]));
    cache.set(key, { retold, at: Date.now() });
    finish(retold);
    settled = true;
    if (retold) {
      yield { kind: 'done', retold };
    } else {
      yield { kind: 'failed', reason: 'invalid' };
    }
  } finally {
    if (!settled) {
      // The consumer walked away mid-stream (disconnect): release the
      // single-flight slot, cache nothing
      finish(null);
    }
    void deltas.return(undefined);
  }
}

export async function getRetold(areaName: string): Promise<Retold | null> {
  const key = areaName.toLowerCase();
  const peeked = peekRetold(areaName);
  if (peeked !== undefined) {
    return peeked.retold;
  }

  // Single-flight: a JSON ask during someone else's generation waits
  // for that one call rather than spending its own
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const started = await startRetoldStream(areaName);
  if (started.kind === 'unavailable') {
    return null;
  }
  if (started.kind === 'join') {
    return inFlight.get(key) ?? getRetold(areaName);
  }
  // Same transport as the streaming route, drained to one answer
  let final: Retold | null = null;
  for await (const event of started.events) {
    if (event.kind === 'done') {
      final = event.retold;
    } else if (event.kind === 'failed' && event.reason === 'interrupted') {
      // The one-shot contract: a transport failure is an error (502),
      // never a false "no retelling" verdict
      throw new Error('Retelling interrupted mid-stream');
    }
  }
  return final;
}
