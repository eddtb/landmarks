import { assertBudget, dailyBudgetUsd, recordSpend, todaysSpend } from '@/server/ai-budget';
import { generateWithGemini, streamWithGemini } from '@/server/gemini';

/**
 * The AI research router. Gemini's free tier is the default for
 * everything; the Anthropic path survives as a config-flip fallback
 * (AI_PROVIDER=anthropic) with its own budget breaker. The venue-era
 * features (What's On, blurbs, busyness) left with the venue half;
 * what remains is the shared plumbing the tellings ride on.
 */

const MessagesEndpoint = 'https://api.anthropic.com/v1/messages';
const Model = 'claude-haiku-4-5';

type MessagesResponse = {
  content?: { type: string; text?: string }[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
};

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

/** Boot-time provider announcement (once per process). */
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

/**
 * Route a generation to the free tier's STREAMING transport — text
 * deltas as the model writes. Same providers, same breakers, same one
 * call as research(); only the transport differs. The dormant Anthropic
 * fallback stays non-streaming and answers as a single whole-text
 * delta — no second call site, no new wire path for the paid provider.
 */
export async function* researchStream(options: {
  prompt: string;
  maxTokens: number;
  grounded: boolean;
  label: string;
}): AsyncGenerator<string, void, void> {
  announceProviderOnce();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && process.env.AI_PROVIDER !== 'anthropic') {
    yield* streamWithGemini({
      apiKey: geminiKey,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      grounded: options.grounded,
      label: options.label,
    });
    return;
  }
  yield await research(options);
}

/** Route a generation to the free tier, or the paid fallback by flip. */
export async function research(options: {
  prompt: string;
  maxTokens: number;
  grounded: boolean;
  label: string;
}): Promise<string> {
  announceProviderOnce();
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && process.env.AI_PROVIDER !== 'anthropic') {
    return generateWithGemini({
      apiKey: geminiKey,
      prompt: options.prompt,
      maxTokens: options.maxTokens,
      grounded: options.grounded,
      label: options.label,
    });
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('No AI provider configured');
  }
  assertBudget();
  const response = await fetch(MessagesEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: Model,
      max_tokens: options.maxTokens,
      ...(options.grounded
        ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }] }
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
