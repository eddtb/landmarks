import { diskBackedMap } from '@/server/ai-cache';

/**
 * A circuit breaker on AI spend, enforced in code BEFORE any billed
 * call leaves the server. The July 2026 credit burn happened because
 * the cost model lived in comments and good intentions; this file
 * replaces intentions with a hard ceiling. When the day's estimated
 * spend reaches the cap, billed calls are refused and every feature
 * degrades exactly as it does on API failure — empty What's On,
 * factual plans — which the app already handles gracefully.
 *
 * The ledger persists to .ai-cache/spend-ledger.json, so it survives
 * restarts (the same property whose absence caused the burn).
 */

type DayEntry = { dollars: number; calls: number };

const ledger = diskBackedMap<DayEntry>('spend-ledger');

const DefaultDailyBudgetUsd = 1;

export function dailyBudgetUsd(): number {
  const configured = Number(process.env.AI_DAILY_BUDGET_USD);
  return Number.isFinite(configured) && configured > 0 ? configured : DefaultDailyBudgetUsd;
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function todaysSpend(): DayEntry {
  return ledger.get(dayKey()) ?? { dollars: 0, calls: 0 };
}

/** Thrown instead of spending: callers already treat errors as "no result". */
export class BudgetExceededError extends Error {
  constructor(spent: number, cap: number) {
    super(
      `AI daily budget reached ($${spent.toFixed(2)} of $${cap.toFixed(2)}) — ` +
        'billed calls refused until tomorrow or a higher AI_DAILY_BUDGET_USD'
    );
    this.name = 'BudgetExceededError';
  }
}

export function assertBudget() {
  const spent = todaysSpend();
  const cap = dailyBudgetUsd();
  if (spent.dollars >= cap) {
    throw new BudgetExceededError(spent.dollars, cap);
  }
}

export function recordSpend(dollars: number) {
  const key = dayKey();
  const entry = ledger.get(key) ?? { dollars: 0, calls: 0 };
  ledger.set(key, { dollars: entry.dollars + dollars, calls: entry.calls + 1 });
}

/** Last week of daily spend, newest first — the /api/ai-spend payload. */
export function recentSpend(): { day: string; dollars: number; calls: number }[] {
  const days: { day: string; dollars: number; calls: number }[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const key = dayKey(date);
    const entry = ledger.get(key);
    if (entry) {
      days.push({ day: key, dollars: Number(entry.dollars.toFixed(4)), calls: entry.calls });
    }
  }
  return days;
}
