import { diskBackedMap } from '@/server/ai-cache';
import { research } from '@/server/anthropic';

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

export async function getTelling(subject: TellingSubject): Promise<string> {
  const key = String(subject.pageId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TtlMs) {
    return cached.text;
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
    cache.set(key, { text, at: Date.now() });
  }
  return text;
}
