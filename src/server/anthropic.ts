import { TodayEvent } from '@/types/today';
import { WhatsOnEvent } from '@/types/whats-on';

/**
 * Server-side only: the Anthropic key must not leak past this module.
 *
 * "What's on" asks Claude (with web search) for a venue's REGULAR
 * recurring events — quiz nights, live music, comedy — which are stable
 * enough to cache for weeks. The prompt's core rule is no-source-no-claim:
 * a hallucinated quiz night that sends someone to a dead pub on a Tuesday
 * is worse than an empty section, so every event must carry the URL that
 * confirms it and finding nothing is a normal, correct outcome.
 */

const MessagesEndpoint = 'https://api.anthropic.com/v1/messages';
/** Cheapest Claude — venue research is well within its reach. */
const Model = 'claude-haiku-4-5';
const MaxSearches = 3;
const MaxEvents = 4;

function whatsOnPrompt(name: string, address: string): string {
  return [
    `Research the regular recurring events (quiz nights, live music, comedy nights, and similar) at this venue: "${name}", ${address}.`,
    '',
    'Rules:',
    '- Only include events confirmed by a specific web page, and include that page URL as sourceUrl.',
    '- Only REGULAR recurring events — no one-off dates, no past events.',
    '- If you find no confirmed regular events, return []. That is a normal answer; never guess.',
    '- Respond with ONLY a JSON array, no other text:',
    '  [{"title": string, "schedule": string, "detail": string (optional), "sourceUrl": string}]',
  ].join('\n');
}

/**
 * Despite the JSON-only instruction, the model often narrates before
 * the array ("Based on the search results…"), so parse the bracketed
 * slice of the text rather than the whole thing.
 */
function parseJsonArraySlice(text: string): Record<string, unknown>[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((entry) => typeof entry === 'object' && entry !== null);
}

/** Pure parsing step, unit-testable without network. */
export function parseWhatsOnEvents(text: string): WhatsOnEvent[] {
  const parsed = parseJsonArraySlice(text);

  return parsed
    .filter(
      (event): event is Record<string, string> =>
        typeof event?.title === 'string' &&
        typeof event?.schedule === 'string' &&
        typeof event?.sourceUrl === 'string' &&
        event.sourceUrl.startsWith('https://')
    )
    .slice(0, MaxEvents)
    .map((event) => ({
      title: event.title,
      schedule: event.schedule,
      ...(typeof event.detail === 'string' && event.detail ? { detail: event.detail } : {}),
      sourceUrl: event.sourceUrl,
    }));
}

type MessagesResponse = {
  content?: { type: string; text?: string }[];
};

async function researchWithWebSearch(options: {
  apiKey: string;
  prompt: string;
  maxTokens: number;
  maxSearches: number;
}): Promise<string> {
  const response = await fetch(MessagesEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Model,
      max_tokens: options.maxTokens,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: options.maxSearches }],
      messages: [{ role: 'user', content: options.prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as MessagesResponse;
  return (body.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
}

export async function fetchWhatsOn(options: {
  apiKey: string;
  name: string;
  address: string;
}): Promise<WhatsOnEvent[]> {
  const text = await researchWithWebSearch({
    apiKey: options.apiKey,
    prompt: whatsOnPrompt(options.name, options.address),
    maxTokens: 900,
    maxSearches: MaxSearches,
  });
  return parseWhatsOnEvents(text);
}

const MaxTodayEvents = 12;
const MaxTodaySearches = 6;

function todayPrompt(dateLabel: string, areaLabel: string): string {
  return [
    `What is on TODAY, ${dateLabel}, in or very near ${areaLabel}?`,
    'Cover the layers separately: street markets open today; cinema programmes (ONE entry per cinema, e.g. "Films showing today", not per showtime); live music and comedy; theatre and shows; exhibitions; festivals and one-offs; big-match sports screenings.',
    '',
    'Rules:',
    '- Only include things confirmed by a specific web page as happening today (or every week on this weekday); include that page URL as sourceUrl.',
    '- Skip anything that clearly ended earlier today.',
    '- If little is on, a short list (or []) is the correct answer; never guess or pad.',
    '- Respond with ONLY a JSON array, no other text:',
    '  [{"title": string, "venue": string, "time": string, "detail": string (optional), "sourceUrl": string}]',
  ].join('\n');
}

/** Pure parsing step, unit-testable without network. */
export function parseTodayEvents(text: string): TodayEvent[] {
  return parseJsonArraySlice(text)
    .filter(
      (event): event is Record<string, string> =>
        typeof event.title === 'string' &&
        typeof event.venue === 'string' &&
        typeof event.time === 'string' &&
        typeof event.sourceUrl === 'string' &&
        event.sourceUrl.startsWith('https://')
    )
    .slice(0, MaxTodayEvents)
    .map((event) => ({
      title: event.title,
      venue: event.venue,
      time: event.time,
      ...(typeof event.detail === 'string' && event.detail ? { detail: event.detail } : {}),
      sourceUrl: event.sourceUrl,
    }));
}

export async function fetchTodayEvents(options: {
  apiKey: string;
  dateLabel: string;
  areaLabel: string;
}): Promise<TodayEvent[]> {
  const text = await researchWithWebSearch({
    apiKey: options.apiKey,
    prompt: todayPrompt(options.dateLabel, options.areaLabel),
    maxTokens: 1500,
    maxSearches: MaxTodaySearches,
  });
  return parseTodayEvents(text);
}
