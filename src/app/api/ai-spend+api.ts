import { anthropicBudget } from '@/server/ai-budget';
import { geminiBudget } from '@/server/gemini';

/** GET /api/ai-spend — the whole AI bill, readable any time. */
export function GET() {
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
