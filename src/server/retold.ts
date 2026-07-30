import { diskBackedMap } from '@/server/ai-cache';
import { storeGet, storePut } from '@/server/telling-store';
import { researchStream } from '@/server/ai-router';
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
// Below this there is genuinely too little to write from — a telling
// covers it. It sat at 3,000 while the app still showed the original
// article under the gate; once that republication was removed (App
// Review kept citing it), the places just under the old gate — six of
// the twenty nearest Greenwich places, each with 1,500-2,500 chars of
// good material — were left showing a ~150-word telling. The prompt now
// scales its ask to the source (see retoldPrompt), so a shorter article
// earns a shorter original account instead of either extreme.
export const MinSourceChars = 1500;
// v3: the gate dropped from 3,000 — the durable no-retell verdicts
// written under the old gate would otherwise block the newly-eligible
// places' retellings for up to 7 days. One prefix, everything under the
// old key regenerates once (30d cache, free tier).
const retoldKey = (areaName: string) => `v3:${areaName.toLowerCase()}`;
const cache = diskBackedMap<{ retold: Retold | null; at: number }>('retold-v3');
// What a joiner learns when the shared generation settles: a VERDICT
// (told, or honestly untellable — 404 material) or an INTERRUPTION
// (transport died, nothing cached — 502 material, retry welcome).
// Settling both as null once made joiners tell users "no retelling
// exists" about stories whose stream merely broke mid-write.
type SharedOutcome = { verdict: Retold | null } | { interrupted: true };
const inFlight = new Map<string, Promise<SharedOutcome>>();

async function joinShared(shared: Promise<SharedOutcome>): Promise<Retold | null> {
  const outcome = await shared;
  if ('interrupted' in outcome) {
    throw new Error('Retelling interrupted mid-stream');
  }
  return outcome.verdict;
}

/** Pure and unit-tested: the contract the model must write to. */
export function retoldPrompt(areaName: string, source: string): string {
  // The ask scales to the material. Demanding 6-9 parts and 1,200+
  // words of a 1,700-character source is an instruction to invent —
  // the one thing the trust contract forbids. A short source earns a
  // short original account, not a padded one.
  const short = source.length < 3000;
  return [
    `You retell local history for a reading app. Retell the story of ${areaName} from the source text below as an engaging ${short ? 'short read' : 'long read'}.`,
    '',
    'Rules:',
    `- Organise it into ${short ? '3 to 5' : '6 to 9'} parts, each with a short evocative heading (2-5 words) that stays honest to its content. Never pad: fewer full parts beat more thin ones.`,
    '- Open the first part with the most surprising true thing — the detail a reader would repeat to a friend.',
    `- Short paragraphs (2-4 sentences each), 2-4 paragraphs per part. Aim for ${short ? '350-700' : '1,200-1,800'} words in total. Concrete details, real dates and names. Written to be read with pleasure, not skimmed.`,
    '- Chronology should generally flow forward after the opening.',
    '- Use ONLY facts from the source text. Never invent. If the source is thin somewhere, write less.',
    '- For each part you MAY include "pullQuote": ONE sentence copied EXACTLY, word for word, from that part\'s body — its most repeatable line. Omit it where nothing stands out.',
    `- Include a top-level "timeline": ${short ? '2 to 4' : '4 to 6'} pivotal dated moments,` +
      ' each {"year": "1491", "label": "Henry VIII born here", "part": 4} — label 3-6 words, facts only from the source, "part" = the 1-based number of the part where that moment is told.',
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
  | { kind: 'cached' } // the durable store answered — peek now hits, serve JSON
  | { kind: 'stream'; events: AsyncGenerator<RetoldStreamEvent, void, void> };

/** The fresh cache entry (a null retold is the "no retelling" verdict), or undefined. */
export function peekRetold(areaName: string): { retold: Retold | null } | undefined {
  const cached = cache.get(retoldKey(areaName));
  if (cached && Date.now() - cached.at < (cached.retold ? TtlMs : NoRetellTtlMs)) {
    return { retold: cached.retold };
  }
  return undefined;
}

export function retellingInFlight(areaName: string): boolean {
  return inFlight.has(retoldKey(areaName));
}

/**
 * The durable store's answer for a key, re-seeded into the
 * per-process map at its ORIGINAL age so both TTL clocks (30d told,
 * 7d "no retelling") keep one truth. On production edge runtimes the
 * map dies with every isolate — without this, each recycle rewrote
 * the same stories, one free-tier call at a time. Undefined means
 * miss, stale, store off, or store unreachable — all one answer:
 * generate.
 */
async function restoreRetold(key: string): Promise<{ retold: Retold | null } | undefined> {
  const stored = await storeGet<{ retold: Retold | null }>('retold', key);
  if (!stored) {
    return undefined;
  }
  const ttl = stored.value.retold ? TtlMs : NoRetellTtlMs;
  if (Date.now() - stored.at >= ttl) {
    return undefined;
  }
  cache.set(key, { retold: stored.value.retold, at: stored.at });
  return { retold: stored.value.retold };
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
  const key = retoldKey(areaName);
  // Single-flight: concurrent opens of the same story share one call
  if (inFlight.has(key)) {
    return { kind: 'join' };
  }
  // Another worker may have told this story already — ask the durable
  // store before spending a call. Re-checked join after the await:
  // a concurrent open may have started generating meanwhile.
  const restored = await restoreRetold(key);
  if (restored !== undefined) {
    return restored.retold ? { kind: 'cached' } : { kind: 'unavailable' };
  }
  if (inFlight.has(key)) {
    return { kind: 'join' };
  }
  let settle!: (outcome: SharedOutcome) => void;
  const shared = new Promise<SharedOutcome>((resolve) => {
    settle = resolve;
  });
  inFlight.set(key, shared);
  const finish = (outcome: SharedOutcome) => {
    inFlight.delete(key);
    settle(outcome);
  };

  try {
    const source = await retellSource(areaName);
    if (source === null) {
      // No article at all: not cached — the article may yet appear
      finish({ verdict: null });
      return { kind: 'unavailable' };
    }
    if (source.length < MinSourceChars) {
      // Stubs don't earn a retelling — not worth a call now, or on the
      // next open, on ANY worker (the verdict is durable too)
      const at = Date.now();
      cache.set(key, { retold: null, at });
      // Awaited: a floating write dies with the isolate (Workers
      // freeze on response) — the verdict must land before we answer
      await storePut('retold', key, { retold: null }, at);
      finish({ verdict: null });
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
    // The initiator gets the real error; joiners must not hear a
    // refused breaker or a dead source as "no retelling exists"
    finish({ interrupted: true });
    throw error;
  }
}

async function* pumpRetold(
  key: string,
  deltas: AsyncGenerator<string, void, void>,
  first: IteratorResult<string, void>,
  finish: (outcome: SharedOutcome) => void
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
      finish({ interrupted: true });
      settled = true;
      yield { kind: 'failed', reason: 'interrupted' };
      return;
    }

    // The model finished writing: the whole-text parse is the verdict,
    // with exactly the one-shot path's caching — a valid telling for
    // 30 days; a completed-but-invalid one as the 7-day "no retelling"
    // verdict (the call was spent; re-spending per open compounds it).
    const retold = parseRetold(extractAnswerText([{ text: raw }]));
    const at = Date.now();
    cache.set(key, { retold, at });
    // Awaited before the final frame: the SSE response is still open
    // here, so the isolate stays alive for the write
    await storePut('retold', key, { retold }, at);
    finish({ verdict: retold });
    settled = true;
    if (retold) {
      yield { kind: 'done', retold };
    } else {
      yield { kind: 'failed', reason: 'invalid' };
    }
  } finally {
    if (!settled) {
      // The consumer walked away mid-stream (disconnect): release the
      // single-flight slot, cache nothing — joiners retry, not 404
      finish({ interrupted: true });
    }
    void deltas.return(undefined);
  }
}

export async function getRetold(areaName: string): Promise<Retold | null> {
  const key = retoldKey(areaName);
  const peeked = peekRetold(areaName);
  if (peeked !== undefined) {
    return peeked.retold;
  }

  // Single-flight: a JSON ask during someone else's generation waits
  // for that one call rather than spending its own
  const pending = inFlight.get(key);
  if (pending) {
    return joinShared(pending);
  }

  const started = await startRetoldStream(areaName);
  if (started.kind === 'unavailable') {
    return null;
  }
  if (started.kind === 'cached') {
    // The durable store answered and re-seeded the map
    return peekRetold(areaName)?.retold ?? null;
  }
  if (started.kind === 'join') {
    const shared = inFlight.get(key);
    return shared ? joinShared(shared) : getRetold(areaName);
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
