import { makeBudget } from '@/server/spend-budget';

/**
 * The Gemini adapter — the free-tier home for every AI feature.
 * Grounded requests (google_search tool) replace Haiku's web search
 * at $0 within the free quota. The breaker here guards CALL COUNT,
 * not dollars: the free tier's cliff is "exceed the daily quota and
 * pay per search", the exact silent-cliff shape the July burn taught
 * us to fence.
 *
 * Measured quirks this adapter absorbs (found in live testing):
 * - 2.5-flash returns thought parts and sometimes duplicates the
 *   answer across parts — naive part-joining breaks bracket-slice
 *   parsing, so thought parts are dropped and a fenced block, when
 *   present, wins.
 * - Grounded sourceUrls are Google redirect links: functional, but
 *   opaque. Accepted for now; the parser's https requirement holds.
 */

const Model = 'gemini-2.5-flash';
const Endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${Model}:generateContent`;

const budget = makeBudget({
  provider: 'Gemini (free-tier calls)',
  ledgerName: 'gemini-call-ledger',
  envVar: 'GEMINI_DAILY_CALLS',
  // Grounded free quota is 500/day on this model — trip well before
  defaultDailyUsd: 300,
});

export const geminiBudget = budget;

type GeminiPart = { text?: string; thought?: boolean };
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
};

/**
 * Pure and unit-tested: thought parts out; the first fenced block
 * that actually parses as JSON wins — grounded responses sometimes
 * truncate a first block mid-URL and then emit a complete repeat.
 */
export function extractAnswerText(parts: GeminiPart[]): string {
  const answer = parts
    .filter((part) => !part.thought && part.text)
    .map((part) => part.text)
    .join('\n');
  const fenced = [...answer.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const block of fenced) {
    try {
      JSON.parse(block);
      return block;
    } catch {
      // truncated or malformed — try the next block
    }
  }
  return (fenced[0] ?? answer).trim();
}

export async function generateWithGemini(options: {
  apiKey: string;
  prompt: string;
  maxTokens: number;
  grounded: boolean;
  label: string;
}): Promise<string> {
  budget.assert();
  const response = await fetch(`${Endpoint}?key=${options.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: options.prompt }] }],
      ...(options.grounded ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: {
        // Grounded answers carry huge redirect URLs — budget for them,
        // and turn thinking off (it silently eats the output budget:
        // measured 36 answer tokens from a 900 cap before this)
        maxOutputTokens: options.grounded ? Math.max(2048, options.maxTokens * 2) : options.maxTokens,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as GeminiResponse;
  budget.record(1);
  const today = budget.todays();
  console.log(
    `[gemini] ${options.label}: ${body.usageMetadata?.promptTokenCount ?? 0} in / ` +
      `${body.usageMetadata?.candidatesTokenCount ?? 0} out, grounded=${options.grounded} ` +
      `(today: ${today.dollars} of ${budget.cap()} free calls)`
  );
  return extractAnswerText(body.candidates?.[0]?.content?.parts ?? []);
}
