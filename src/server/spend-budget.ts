import { diskBackedMap } from '@/server/ai-cache';

/**
 * The budget factory: one circuit-breaker pattern for every paid
 * provider. Ceilings live in code, enforced BEFORE a call spends;
 * ledgers persist to disk so restarts can't reset the count. Born
 * from the July 2026 credit burn — cost models in comments are
 * worthless, cost models in code refuse.
 */

type DayEntry = { dollars: number; calls: number };

export class BudgetExceededError extends Error {
  constructor(provider: string, spent: number, cap: number) {
    super(
      `${provider} daily budget reached ($${spent.toFixed(2)} of $${cap.toFixed(2)}) — ` +
        'billed calls refused until tomorrow or a higher cap'
    );
    this.name = 'BudgetExceededError';
  }
}

function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export type SpendBudget = {
  /** Throws BudgetExceededError at the cap — call BEFORE spending. */
  assert: () => void;
  record: (dollars: number) => void;
  todays: () => DayEntry;
  cap: () => number;
  /** Last week of daily spend, newest first. */
  recent: () => { day: string; dollars: number; calls: number }[];
};

export function makeBudget(options: {
  provider: string;
  ledgerName: string;
  envVar: string;
  defaultDailyUsd: number;
}): SpendBudget {
  const { provider, ledgerName, envVar, defaultDailyUsd } = options;
  const ledger = diskBackedMap<DayEntry>(ledgerName);

  const cap = () => {
    const configured = Number(process.env[envVar]);
    return Number.isFinite(configured) && configured > 0 ? configured : defaultDailyUsd;
  };

  const todays = () => ledger.get(dayKey()) ?? { dollars: 0, calls: 0 };

  return {
    cap,
    todays,
    assert: () => {
      const spent = todays();
      if (spent.dollars >= cap()) {
        throw new BudgetExceededError(provider, spent.dollars, cap());
      }
    },
    record: (dollars: number) => {
      const key = dayKey();
      const entry = ledger.get(key) ?? { dollars: 0, calls: 0 };
      ledger.set(key, { dollars: entry.dollars + dollars, calls: entry.calls + 1 });
    },
    recent: () => {
      const days: { day: string; dollars: number; calls: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const entry = ledger.get(dayKey(date));
        if (entry) {
          days.push({
            day: dayKey(date),
            dollars: Number(entry.dollars.toFixed(4)),
            calls: entry.calls,
          });
        }
      }
      return days;
    },
  };
}
