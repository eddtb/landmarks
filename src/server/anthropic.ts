import { assertBudget, dailyBudgetUsd, recordSpend, todaysSpend } from '@/server/ai-budget';
import { generateWithGemini } from '@/server/gemini';
import {
  BusynessLevels,
  BusynessPattern,
  DayBands,
  DayPattern,
  Weekdays,
} from '@/types/busyness';
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
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
};

/**
 * Spend visibility: every billed call logs its own usage and the
 * running session total, priced at Haiku rates ($1/M in, $5/M out,
 * $10/1k searches). The searches dominate — this line is how a
 * runaway pattern gets noticed in the dev logs instead of on the
 * billing page.
 */
const spend = ((globalThis as { aiSpend?: { calls: number; dollars: number } }).aiSpend ??= {
  calls: 0,
  dollars: 0,
});

function logUsage(label: string, usage: MessagesResponse['usage']) {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  const searches = usage?.server_tool_use?.web_search_requests ?? 0;
  const dollars = input / 1e6 + (output * 5) / 1e6 + searches / 100;
  spend.calls += 1;
  spend.dollars += dollars;
  recordSpend(dollars);
  console.log(
    `[ai] ${label}: ${input} in / ${output} out / ${searches} searches ≈ $${dollars.toFixed(4)} ` +
      `(session: ${spend.calls} calls ≈ $${spend.dollars.toFixed(2)}, ` +
      `today: $${todaysSpend().dollars.toFixed(2)} of $${dailyBudgetUsd().toFixed(2)})`
  );
}

/**
 * Boot-time provider announcement (once per process): a dev server
 * started before GEMINI_API_KEY existed in .env.local silently fell
 * back to paid Anthropic — this line makes the active provider
 * impossible to miss in the logs.
 */
function announceProviderOnce() {
  const flag = globalThis as { aiProviderAnnounced?: boolean };
  if (flag.aiProviderAnnounced) {
    return;
  }
  flag.aiProviderAnnounced = true;
  const provider =
    process.env.GEMINI_API_KEY && process.env.AI_PROVIDER !== 'anthropic'
      ? 'gemini (free tier)'
      : process.env.ANTHROPIC_API_KEY
        ? 'ANTHROPIC — PAID, is this intended?'
        : 'none (AI features disabled)';
  console.log(`[ai] provider: ${provider}`);
}

async function researchWithWebSearch(options: {
  apiKey: string;
  prompt: string;
  maxTokens: number;
  maxSearches: number;
  label: string;
}): Promise<string> {
  announceProviderOnce();
  // Provider routing: Gemini's free tier is the default home for
  // every feature (grounded search replaces web search); Anthropic
  // remains one env flip away (AI_PROVIDER=anthropic) as fallback.
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && process.env.AI_PROVIDER !== 'anthropic') {
    return generateWithGemini({
      apiKey: geminiKey,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      grounded: options.maxSearches > 0,
      label: options.label,
    });
  }
  // The circuit breaker: at the daily cap, refuse BEFORE spending.
  // Callers already treat a throw as "no result" and degrade quietly.
  assertBudget();
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
      // maxSearches 0 = pure reasoning (busyness forecasts) — no tool at all
      ...(options.maxSearches > 0
        ? {
            tools: [
              { type: 'web_search_20250305', name: 'web_search', max_uses: options.maxSearches },
            ],
          }
        : {}),
      messages: [{ role: 'user', content: options.prompt }],
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as MessagesResponse;
  logUsage(options.label, body.usage);
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
    label: 'whats-on',
  });
  return parseWhatsOnEvents(text);
}

/**
 * Busyness is a FORECAST, not a lookup: no web search, just the model
 * reasoning over signals we already hold — the way a local would guess.
 * The UI must always frame the result as "usually" + an estimate label.
 */
function busynessPrompt(options: {
  name: string;
  typeLabel: string;
  ratingCount: number;
  address: string;
  events: string[];
}): string {
  const { name, typeLabel, ratingCount, address, events } = options;
  return [
    `Estimate how busy this venue TYPICALLY is through the week, like a knowledgeable local would: "${name}" (${typeLabel}), ${address}. It has ${ratingCount} Google reviews (popularity signal).`,
    events.length > 0 ? `Known regular events: ${events.join('; ')}.` : '',
    '',
    'Bands: morning (8am-12), afternoon (12-5pm), evening (5-8pm), night (8pm-close).',
    'Levels: "quiet" | "moderate" | "busy" | "packed".',
    'Consider venue type rhythms (pubs peak Friday/Saturday nights, cafes peak weekend mornings), popularity, and the known events.',
    'Respond with ONLY JSON, no other text:',
    '  {"pattern": {"Monday": {"morning": level, "afternoon": level, "evening": level, "night": level}, ... all seven days ...}, "note": string (optional — ONE standout worth knowing, max 8 words, e.g. "packed on Sunday quiz nights")}',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Pure parsing step. Strict by design: a pattern missing any day or
 * band is rejected outright — a partial forecast would silently show
 * wrong "around this time" answers for the missing slots.
 */
export function parseBusynessPattern(text: string): BusynessPattern | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const root = parsed as { pattern?: Record<string, Record<string, string>>; note?: unknown };
  if (typeof root?.pattern !== 'object' || root.pattern === null) {
    return null;
  }

  const pattern = {} as Record<(typeof Weekdays)[number], DayPattern>;
  for (const day of Weekdays) {
    const dayEntry = root.pattern[day];
    if (typeof dayEntry !== 'object' || dayEntry === null) {
      return null;
    }
    const dayPattern = {} as DayPattern;
    for (const band of DayBands) {
      const level = dayEntry[band];
      if (!BusynessLevels.includes(level as (typeof BusynessLevels)[number])) {
        return null;
      }
      dayPattern[band] = level as (typeof BusynessLevels)[number];
    }
    pattern[day] = dayPattern;
  }

  return {
    pattern,
    ...(typeof root.note === 'string' && root.note ? { note: root.note } : {}),
  };
}

/**
 * The last link in the description trust chain: Wikipedia story →
 * Google editorial → this → nothing. Claude researches what a place
 * actually is; the must-decline rule means "nothing found" beats a
 * confident invention — for junk listings especially (the motivating
 * case: a gallery whose owner-entered data is 24/7 hours and a
 * Cantonese address).
 */
function blurbPrompt(name: string, typeLabel: string, address: string): string {
  return [
    `In one or two plain, factual sentences, describe what "${name}" (${typeLabel}) at ${address} actually is, for a local discovery app. Use web search.`,
    '',
    'Rules:',
    '- Only state what a web source confirms; no guessing, no marketing tone.',
    '- If you cannot find reliable information about this specific place, decline.',
    '- Respond with ONLY JSON, no other text: {"blurb": string} or {"blurb": null} to decline.',
  ].join('\n');
}

/** Pure parsing step, unit-testable without network. */
export function parseBlurb(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const blurb = (parsed as { blurb?: unknown })?.blurb;
  if (typeof blurb !== 'string') {
    return null;
  }
  // The web-search tooling laces answers with <cite> tags — strip them
  const trimmed = blurb
    .replace(/<\/?cite[^>]*>/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Too short to inform or long enough to be rambling — decline instead
  return trimmed.length >= 20 && trimmed.length <= 400 ? trimmed : null;
}

export async function fetchPlaceBlurb(options: {
  apiKey: string;
  name: string;
  typeLabel: string;
  address: string;
}): Promise<string | null> {
  const text = await researchWithWebSearch({
    apiKey: options.apiKey,
    prompt: blurbPrompt(options.name, options.typeLabel, options.address),
    maxTokens: 600,
    maxSearches: 2,
    label: 'blurb',
  });
  return parseBlurb(text);
}

export async function fetchBusynessPattern(options: {
  apiKey: string;
  name: string;
  typeLabel: string;
  ratingCount: number;
  address: string;
  events: string[];
}): Promise<BusynessPattern | null> {
  const text = await researchWithWebSearch({
    apiKey: options.apiKey,
    prompt: busynessPrompt(options),
    maxTokens: 800,
    maxSearches: 0,
    label: 'busyness',
  });
  return parseBusynessPattern(text);
}

/** Claude's half of the Plan engine: title + why-lines. Facts stay ours. */
export type PlanAnnotations = {
  title: string;
  whys: Record<string, string>;
  legNotes: Record<string, string>;
};

export function parsePlanAnnotations(text: string): PlanAnnotations | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const candidate = parsed as { title?: unknown; whys?: unknown; legNotes?: unknown };
  if (typeof candidate.title !== 'string' || typeof candidate.whys !== 'object' || !candidate.whys) {
    return null;
  }
  const whys: Record<string, string> = {};
  for (const [placeId, why] of Object.entries(candidate.whys as Record<string, unknown>)) {
    if (typeof why === 'string' && why.trim().length > 0) {
      whys[placeId] = why.replace(/<\/?cite[^>]*>/g, '').trim().slice(0, 140);
    }
  }
  const legNotes: Record<string, string> = {};
  if (candidate.legNotes && typeof candidate.legNotes === 'object') {
    for (const [index, note] of Object.entries(candidate.legNotes as Record<string, unknown>)) {
      if (typeof note === 'string' && note.trim().length > 0) {
        legNotes[index] = note.trim().slice(0, 90);
      }
    }
  }
  return { title: candidate.title.trim().slice(0, 60), whys, legNotes };
}

function planAnnotationPrompt(brief: string): string {
  return (
    'You are writing the short human lines for a walking-outing plan composed from verified data. ' +
    'You are given the chosen stops IN ORDER with verified facts, the occasion, and conditions. ' +
    'Do NOT state facts (hours, ratings, prices) and NEVER mention clock times or numbers — timing renders separately and your brief may be in a different timezone. Do NOT invent places or claims. ' +
    'Write: a plan title (max 6 words, evocative, no puns forced), one "why" line per stop AND per listed alternative (every placeId in the brief gets a why) ' +
    '(max 18 words, specific to what makes it right for THIS occasion and moment, grounded ONLY in the provided facts and editorial notes), ' +
    'and optional leg notes keyed by leg index (max 10 words, only when conditions genuinely warrant one — golden hour, rain, a riverside stretch).\n\n' +
    'Respond with ONLY JSON: {"title": "...", "whys": {"<placeId>": "..."}, "legNotes": {"<legIndex>": "..."}}\n\n' +
    brief
  );
}

export async function fetchPlanAnnotations(options: {
  apiKey: string;
  brief: string;
}): Promise<PlanAnnotations | null> {
  const text = await researchWithWebSearch({
    apiKey: options.apiKey,
    prompt: planAnnotationPrompt(options.brief),
    maxTokens: 900,
    maxSearches: 0,
    label: 'plan',
  });
  return parsePlanAnnotations(text);
}
