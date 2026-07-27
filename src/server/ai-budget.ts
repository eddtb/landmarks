import { BudgetExceededError, makeBudget } from '@/server/spend-budget';

/**
 * The Anthropic breaker — see spend-budget.ts for the pattern. When
 * the day's estimated spend reaches the cap, billed calls are refused
 * and every feature degrades exactly as it does on API failure.
 */
const budget = makeBudget({
  provider: 'Anthropic',
  ledgerName: 'spend-ledger',
  envVar: 'AI_DAILY_BUDGET_USD',
  unit: 'usd',
  defaultDailyCap: 1,
});

export const anthropicBudget = budget;

export { BudgetExceededError };

export function dailyBudgetUsd(): number {
  return budget.cap();
}

export function todaysSpend() {
  return budget.todays();
}

export function assertBudget(): Promise<void> {
  return budget.assert();
}

export function recordSpend(dollars: number): Promise<void> {
  return budget.record(dollars);
}
