import { anthropicBudget, assertBudget, BudgetExceededError, recordSpend, todaysSpend } from '@/server/ai-budget';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  rmSync: (path: string) => void;
};

describe('the AI spend circuit breaker', () => {
  // The debounced disk write can land AFTER afterAll's delete,
  // poisoning the next run — so clean before, not just after
  beforeAll(() => {
    // The module's ledger closure hydrated at import — clear CONTENTS
    anthropicBudget.reset();
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete('spend-ledger');
    if (existsSync('.ai-cache-test/spend-ledger.json')) {
      rmSync('.ai-cache-test/spend-ledger.json');
    }
  });

  afterAll(() => {
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete('spend-ledger');
    if (existsSync('.ai-cache-test/spend-ledger.json')) {
      rmSync('.ai-cache-test/spend-ledger.json');
    }
  });

  test('spends freely under the cap, refuses at it', () => {
    expect(() => assertBudget()).not.toThrow();

    recordSpend(0.4);
    recordSpend(0.35);
    expect(todaysSpend().dollars).toBeCloseTo(0.75);
    expect(todaysSpend().calls).toBe(2);
    expect(() => assertBudget()).not.toThrow();

    recordSpend(0.3);
    // $1.05 >= the $1 default cap: every further billed call refuses
    expect(() => assertBudget()).toThrow(BudgetExceededError);
  });

  test('a higher configured budget lifts the ceiling', () => {
    process.env.AI_DAILY_BUDGET_USD = '5';
    try {
      expect(() => assertBudget()).not.toThrow();
    } finally {
      delete process.env.AI_DAILY_BUDGET_USD;
    }
    expect(() => assertBudget()).toThrow(BudgetExceededError);
  });
});
