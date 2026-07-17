import { dailyBudgetUsd, recentSpend, todaysSpend } from '@/server/ai-budget';

/**
 * GET /api/ai-spend — the AI bill, readable any time without opening
 * the provider console. Estimates priced at Haiku rates; the ledger
 * persists across restarts.
 */
export function GET() {
  const today = todaysSpend();
  return Response.json({
    today: { dollars: Number(today.dollars.toFixed(4)), calls: today.calls },
    dailyBudgetUsd: dailyBudgetUsd(),
    lastWeek: recentSpend(),
  });
}
