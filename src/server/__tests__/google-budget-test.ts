import { chargeGoogle, GoogleCallCostUsd, googleBudget } from '@/server/google-budget';
import { BudgetExceededError } from '@/server/spend-budget';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  rmSync: (path: string) => void;
};

describe('the Google spend circuit breaker', () => {
  // The debounced disk write can land AFTER afterAll's delete,
  // poisoning the next run — so clean before, not just after
  beforeAll(() => {
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete('google-spend-ledger');
    if (existsSync('.ai-cache/google-spend-ledger.json')) {
      rmSync('.ai-cache/google-spend-ledger.json');
    }
  });

  afterAll(() => {
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete(
      'google-spend-ledger'
    );
    if (existsSync('.ai-cache/google-spend-ledger.json')) {
      rmSync('.ai-cache/google-spend-ledger.json');
    }
  });

  test('records list-rate estimates per call kind and refuses at the cap', () => {
    chargeGoogle('nearbySearch');
    chargeGoogle('nearbySearch');
    chargeGoogle('placeDetails');
    expect(googleBudget.todays().dollars).toBeCloseTo(
      GoogleCallCostUsd.nearbySearch * 2 + GoogleCallCostUsd.placeDetails
    );
    expect(googleBudget.todays().calls).toBe(3);

    // Force the ledger to the cap: every further call must refuse
    googleBudget.record(googleBudget.cap());
    expect(() => chargeGoogle('route')).toThrow(BudgetExceededError);
  });
});
