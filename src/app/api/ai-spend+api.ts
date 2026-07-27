import { anthropicBudget } from '@/server/ai-budget';
import { geminiBudget } from '@/server/gemini';

/**
 * GET /api/ai-spend — the whole AI bill, readable any time in dev.
 * In production the numbers are recon for quota attackers (watch the
 * breaker, time the drain), so the route answers only with the token:
 * set AI_SPEND_TOKEN in the hosting env and ask with ?token=…
 * No token configured means nobody reads it — closed by default.
 */
export function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const token = process.env.AI_SPEND_TOKEN;
    const given = new URL(request.url).searchParams.get('token');
    if (!token || given !== token) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  }
  const anthropic = anthropicBudget.todays();
  const gemini = geminiBudget.todays();
  return Response.json({
    gemini: {
      today: { calls: gemini.dollars, callCount: gemini.calls },
      dailyFreeCallCap: geminiBudget.cap(),
      lastWeek: geminiBudget.recent(),
    },
    anthropic: {
      today: { dollars: Number(anthropic.dollars.toFixed(4)), calls: anthropic.calls },
      dailyBudgetUsd: anthropicBudget.cap(),
      lastWeek: anthropicBudget.recent(),
    },
  });
}
