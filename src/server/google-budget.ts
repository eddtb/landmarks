import { makeBudget } from '@/server/spend-budget';

/**
 * The Google Maps Platform breaker. Prices are list-rate estimates
 * per call (2026): the nearby searches are the expensive unit — the
 * routingSummaries field bills them at the top Places SKU, and every
 * category browse runs two. Estimates deliberately round UP; an
 * over-counted ledger trips early, never late.
 */
export const GoogleCallCostUsd = {
  /** Nearby Search with routingSummaries — top tier, per query. */
  nearbySearch: 0.05,
  /** Place Details with Pro/Enterprise fields. */
  placeDetails: 0.03,
  /** photos.name-only details lookup (photo token refresh). */
  photoNames: 0.01,
  /** Routes computeRoutes, walking. */
  route: 0.01,
  /** Photo media resolution. */
  photoMedia: 0.007,
  /** Street View static image (metadata check is free). */
  streetView: 0.007,
} as const;

export type GoogleCallKind = keyof typeof GoogleCallCostUsd;

const budget = makeBudget({
  provider: 'Google Maps Platform',
  ledgerName: 'google-spend-ledger',
  envVar: 'GOOGLE_DAILY_BUDGET_USD',
  defaultDailyUsd: 5,
});

export const googleBudget = budget;

/**
 * The one call every billed Google fetch must make first. Throws at
 * the cap (callers already catch and degrade); records the estimate
 * on the way through, and logs the running total.
 */
export function chargeGoogle(kind: GoogleCallKind) {
  budget.assert();
  const dollars = GoogleCallCostUsd[kind];
  budget.record(dollars);
  const today = budget.todays();
  console.log(
    `[google] ${kind} ≈ $${dollars.toFixed(3)} — day total across ALL kinds: $${today.dollars.toFixed(2)} of $${budget.cap().toFixed(2)} cap (${today.calls} calls, estimates rounded up; real billing sits inside free allowances)`
  );
}
