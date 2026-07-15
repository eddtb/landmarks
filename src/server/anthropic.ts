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

/** Pure parsing step, unit-testable without network. */
export function parseWhatsOnEvents(text: string): WhatsOnEvent[] {
  const stripped = text.replace(/```(?:json)?/g, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }

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

export async function fetchWhatsOn(options: {
  apiKey: string;
  name: string;
  address: string;
}): Promise<WhatsOnEvent[]> {
  const { apiKey, name, address } = options;

  const response = await fetch(MessagesEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Model,
      max_tokens: 900,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: MaxSearches }],
      messages: [{ role: 'user', content: whatsOnPrompt(name, address) }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as MessagesResponse;
  const text = (body.content ?? [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
  return parseWhatsOnEvents(text);
}
