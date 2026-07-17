import { anthropicBudget } from '@/server/ai-budget';
import { googleBudget } from '@/server/google-budget';

/**
 * GET /api/ai-spend — the whole paid-API bill, readable any time
 * without opening a provider console. Estimates priced at list
 * rates, rounded up; ledgers persist across restarts.
 */
export function GET() {
  const anthropic = anthropicBudget.todays();
  const google = googleBudget.todays();
  return Response.json({
    anthropic: {
      today: { dollars: Number(anthropic.dollars.toFixed(4)), calls: anthropic.calls },
      dailyBudgetUsd: anthropicBudget.cap(),
      lastWeek: anthropicBudget.recent(),
    },
    google: {
      today: { dollars: Number(google.dollars.toFixed(4)), calls: google.calls },
      dailyBudgetUsd: googleBudget.cap(),
      lastWeek: googleBudget.recent(),
    },
  });
}
