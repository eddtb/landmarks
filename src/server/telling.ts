import { diskBackedMap } from '@/server/ai-cache';
import { research } from '@/server/ai-router';
import { storeGet, storePut } from '@/server/telling-store';

/**
 * The telling: a ~one-minute spoken narration of a story, written by
 * the free-tier model from the source extract alone — no search, no
 * grounding, nothing billable. The voice contract is Edd's: open with
 * the most surprising true thing, never assume the listener is at the
 * site, make it something a person would choose to press play on.
 */

const TtlMs = 30 * 24 * 60 * 60 * 1000;

type CachedTelling = { text: string; at: number };
const cache = diskBackedMap<CachedTelling>('tellings');
// One generation per key at a time: concurrent opens of the same story
// join the in-flight call instead of each spending a free-tier unit.
const inFlight = new Map<string, Promise<string>>();

/**
 * The extract rides in from the client (the server holds no per-story
 * state), so the cache key must bind the telling to the text it was
 * written from: a fabricated extract POSTed to the public route may
 * only ever poison its own slot, never the one real clients — who all
 * send the same cleaned source text — read for the next 30 days.
 * SHA-256 so a matching key can't be crafted for someone else's text.
 */
export async function extractKeyPart(extract: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(extract));
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export type TellingSubject = {
  pageId: number;
  title: string;
  extract: string;
  source: string;
};

/** Pure and unit-tested: the voice contract lives here. */
export function tellingPrompt(subject: TellingSubject): string {
  return [
    'You write one-minute spoken tellings of local history for a walking app.',
    'Write the telling of the subject below — about 150 words, to be read aloud.',
    '',
    'Rules:',
    '- Open with the most surprising true detail — the thing a listener would repeat to a friend — then earn the context around it.',
    '- Speak warmly and directly, but never assume the listener is at the site: no "ahead of you", no "where you\'re standing". They may be at home, planning tomorrow\'s walk.',
    '- Short sentences that read aloud well. Concrete details. An ending that lands.',
    '- Use only facts in the source text. If the source is thin, write a shorter telling rather than inventing anything.',
    '- Plain prose only: no headings, no lists, no stage directions, no quotation marks around the whole text.',
    '',
    `Subject: ${subject.title}`,
    `Source (${subject.source}): ${subject.extract}`,
  ].join('\n');
}

export async function getTelling(
  subject: TellingSubject,
  // Areas have no pageId — they cache under "area:greenwich"
  cacheKey = String(subject.pageId)
): Promise<string> {
  const key = `${cacheKey}:${await extractKeyPart(subject.extract)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TtlMs) {
    return cached.text;
  }

  const joined = inFlight.get(key);
  if (joined) {
    return joined;
  }
  const run = tellUncached(subject, key);
  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

async function tellUncached(subject: TellingSubject, key: string): Promise<string> {
  // The durable store outlives the worker: on production edge
  // runtimes the map above dies with every isolate, and each story
  // was being rewritten per recycle. A store hit re-seeds the map at
  // its ORIGINAL age, so the 30-day clock keeps one truth.
  const stored = await storeGet<CachedTelling>('telling', key);
  if (stored && stored.value.text && Date.now() - stored.at < TtlMs) {
    cache.set(key, { text: stored.value.text, at: stored.at });
    return stored.value.text;
  }

  const text = (
    await research({
      prompt: tellingPrompt(subject),
      maxTokens: 400,
      grounded: false,
      label: `telling:${subject.title}`,
    })
  ).trim();

  if (text) {
    const at = Date.now();
    cache.set(key, { text, at });
    // Awaited: Workers freeze the isolate once the response returns —
    // a floating write here silently never lands (production-proved)
    await storePut('telling', key, { text, at }, at);
  }
  return text;
}
