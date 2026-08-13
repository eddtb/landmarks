import { anthropicBudget } from '@/server/ai-budget';
import { geminiBudget } from '@/server/gemini';

/**
 * GET /api/ai-spend — the whole AI bill.
 *
 * The numbers are recon for quota attackers (watch the breaker, time
 * the drain), so the TOKEN is the gate: set AI_SPEND_TOKEN in the
 * hosting env and ask with ?token=… No token configured means nobody
 * reads it — closed by default, in every environment.
 *
 * It used to be closed by NODE_ENV === 'production', which is the
 * same shape as the deploy that shipped without --environment
 * production: correctness resting on a variable nobody sets
 * deliberately, failing quietly and failing OPEN. Any worker whose
 * NODE_ENV read anything else served the exact remaining free-tier
 * quota and seven days of call history to whoever asked. A route's
 * exposure now depends only on what someone chose to configure.
 *
 * Local reading is a deliberate act too: AI_SPEND_OPEN=1 alongside a
 * dev server, which is not a thing any environment sets by accident.
 */
export async function GET(request: Request) {
  const token = process.env.AI_SPEND_TOKEN;
  if (token) {
    if (new URL(request.url).searchParams.get('token') !== token) {
      return Response.json({ error: 'Not found' }, { status: 404 });
    }
  } else if (process.env.AI_SPEND_OPEN !== '1') {
    return Response.json({ error: 'Not found' }, { status: 404 });
  }
  // The durable-merged view: what every isolate spent, not just this one
  const anthropic = await anthropicBudget.todaysDurable();
  const gemini = await geminiBudget.todaysDurable();
  return Response.json({
    gemini: {
      // A calls-unit budget: dollars are always zero, so they don't ride
      today: { calls: gemini.calls },
      dailyFreeCallCap: geminiBudget.cap(),
      lastWeek: (await geminiBudget.recent()).map(({ day, calls }) => ({ day, calls })),
    },
    anthropic: {
      today: { dollars: Number(anthropic.dollars.toFixed(4)), calls: anthropic.calls },
      dailyBudgetUsd: anthropicBudget.cap(),
      lastWeek: await anthropicBudget.recent(),
    },
  });
}
