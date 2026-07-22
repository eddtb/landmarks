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
const StreamEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${Model}:streamGenerateContent`;

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

type GenerateOptions = {
  apiKey: string;
  prompt: string;
  maxTokens: number;
  grounded: boolean;
  label: string;
};

/** One request body for both transports — the call is the same call. */
function requestBody(options: GenerateOptions): string {
  return JSON.stringify({
    contents: [{ parts: [{ text: options.prompt }] }],
    ...(options.grounded ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      // Grounded answers carry huge redirect URLs — budget for them,
      // and turn thinking off (it silently eats the output budget:
      // measured 36 answer tokens from a 900 cap before this)
      maxOutputTokens: options.grounded ? Math.max(2048, options.maxTokens * 2) : options.maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });
}

export async function generateWithGemini(options: GenerateOptions): Promise<string> {
  budget.assert();
  const response = await fetch(`${Endpoint}?key=${options.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody(options),
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

/**
 * Pure and unit-tested: the wire decoder for streamGenerateContent's
 * alt=sse framing. Each `data:` line is one complete GenerateContent
 * chunk; feed() takes network chunks (which may split a line anywhere)
 * and returns the text deltas that completed. Thought parts are
 * dropped exactly as in the non-streaming path; an error chunk throws.
 */
export function makeGeminiSseDecoder(): {
  feed(chunk: string): string[];
  usage(): GeminiResponse['usageMetadata'];
} {
  let buffer = '';
  let usage: GeminiResponse['usageMetadata'];
  return {
    usage: () => usage,
    feed(chunk: string): string[] {
      buffer += chunk;
      const deltas: string[] = [];
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) {
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload) {
          continue;
        }
        let parsed: GeminiResponse;
        try {
          parsed = JSON.parse(payload) as GeminiResponse;
        } catch {
          // A line that isn't JSON isn't a delta; the end-of-stream
          // validation is the verdict on anything lost here
          continue;
        }
        if (parsed.error?.message) {
          throw new Error(`Gemini stream error: ${parsed.error.message.slice(0, 500)}`);
        }
        usage = parsed.usageMetadata ?? usage;
        for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
          if (!part.thought && part.text) {
            deltas.push(part.text);
          }
        }
      }
      return deltas;
    },
  };
}

/**
 * The SAME telling call over the streaming transport: one request, one
 * quota unit, text deltas as the model writes. The breaker gates the
 * stream exactly as it gates generateContent — assert() runs before
 * anything opens, so REPLAY_ONLY and a tripped budget refuse without
 * a byte sent. The call is recorded the moment Gemini accepts it: a
 * stream cut short still burned a call.
 */
export async function* streamWithGemini(options: GenerateOptions): AsyncGenerator<string, void, void> {
  budget.assert();
  const response = await fetch(`${StreamEndpoint}?alt=sse&key=${options.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: requestBody(options),
  });
  if (!response.ok || !response.body) {
    const detail = response.ok ? 'no response body' : await response.text();
    throw new Error(`Gemini API ${response.status}: ${detail.slice(0, 500)}`);
  }
  budget.record(1);

  const decoder = makeGeminiSseDecoder();
  const reader = response.body.getReader();
  const bytes = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      for (const delta of decoder.feed(bytes.decode(value, { stream: true }))) {
        yield delta;
      }
    }
  } finally {
    // An abandoned consumer (client disconnect) lands here too —
    // release the upstream socket rather than draining it
    void reader.cancel().catch(() => {});
    const usage = decoder.usage();
    const today = budget.todays();
    console.log(
      `[gemini] ${options.label}: ${usage?.promptTokenCount ?? 0} in / ` +
        `${usage?.candidatesTokenCount ?? 0} out, streamed, grounded=${options.grounded} ` +
        `(today: ${today.dollars} of ${budget.cap()} free calls)`
    );
  }
}
