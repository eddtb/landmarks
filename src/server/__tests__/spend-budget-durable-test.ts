import { makeBudget } from '@/server/spend-budget';

/**
 * The breaker's Workers truth: the local ledger is per-isolate memory
 * that resets on every recycle. What makes "300/day" mean 300 is the
 * durable ledger — a fresh isolate must refuse when OTHER isolates
 * already spent the day's cap.
 */

jest.mock('@/server/telling-store', () => ({
  storeGet: jest.fn(async () => undefined),
  storeAdd: jest.fn(async () => undefined),
}));

const { storeGet, storeAdd } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/server/telling-store') as { storeGet: jest.Mock; storeAdd: jest.Mock };

function freshBudget(name: string, unit: 'calls' | 'usd' = 'usd') {
  const budget = makeBudget({
    provider: 'Test provider',
    ledgerName: name,
    envVar: 'TEST_DAILY_CAP',
    unit,
    defaultDailyCap: 300,
  });
  // The disk ledger outlives the run BY DESIGN — start from zero
  budget.reset();
  return budget;
}

const today = new Date().toISOString().slice(0, 10);

describe('the durable day-ledger', () => {
  beforeEach(() => {
    storeGet.mockReset();
    storeGet.mockResolvedValue(undefined);
    storeAdd.mockReset();
  });

  test("a fresh isolate refuses on the OTHER isolates' spend", async () => {
    const budget = freshBudget('durable-a');
    // Local ledger empty — this isolate never spent a thing — but the
    // fleet already reached the cap today
    storeGet.mockResolvedValue({ value: { dollars: 300, calls: 300 }, at: Date.now() });

    await expect(budget.assert()).rejects.toThrow(/daily budget reached/);
    expect(storeGet).toHaveBeenCalledWith('ledger', `durable-a:${today}`);
  });

  test('every record lands in the durable ledger under the day key', async () => {
    const budget = freshBudget('durable-b');
    await budget.record(1);
    expect(storeAdd).toHaveBeenCalledWith('ledger', `durable-b:${today}`, 1, expect.any(Number));
  });

  test('store down degrades to the local view — never a false refusal', async () => {
    const budget = freshBudget('durable-c');
    storeGet.mockResolvedValue(undefined); // off / unreachable = miss
    await expect(budget.assert()).resolves.toBeUndefined();
  });

  test('the merged view is a max, not a sum — a spend never counts twice', async () => {
    const budget = freshBudget('durable-d');
    await budget.record(1);
    await budget.record(1);
    // The durable ledger saw the same two spends (this isolate wrote
    // them) plus one from elsewhere
    storeGet.mockResolvedValue({ value: { dollars: 3, calls: 3 }, at: Date.now() });
    expect(await budget.todaysDurable()).toEqual({ dollars: 3, calls: 3 });
  });
});

describe('a calls-unit budget', () => {
  beforeEach(() => {
    storeGet.mockReset();
    storeGet.mockResolvedValue(undefined);
    storeAdd.mockReset();
  });

  test('counts calls, not a call count smuggled into dollars', async () => {
    const budget = freshBudget('durable-calls', 'calls');
    await budget.record();
    await budget.record();
    expect(budget.todays()).toEqual({ dollars: 0, calls: 2 });
    expect(storeAdd).toHaveBeenCalledWith('ledger', expect.any(String), 0, expect.any(Number));
  });

  test('refuses on the CALL total and says so in calls', async () => {
    const budget = freshBudget('durable-calls-cap', 'calls');
    // Dollars stayed zero all day — only the call count can trip it
    storeGet.mockResolvedValue({ value: { dollars: 0, calls: 300 }, at: Date.now() });
    await expect(budget.assert()).rejects.toThrow('300 of 300 calls');
  });
});
