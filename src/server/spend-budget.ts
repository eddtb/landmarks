import { diskBackedMap } from '@/server/ai-cache';
import { storeAdd, storeGet } from '@/server/telling-store';

/**
 * The budget factory: one circuit-breaker pattern for every paid
 * provider. Ceilings live in code, enforced BEFORE a call spends;
 * ledgers persist so restarts can't reset the count. Born from the
 * July 2026 credit burn — cost models in comments are worthless, cost
 * models in code refuse.
 *
 * Two ledgers, one truth: the disk map is the fast local view, but on
 * production edge runtimes it is per-isolate memory that resets with
 * every recycle — which quietly turned "300/day" into "300 per isolate
 * lifetime". The durable ledger (Turso, the same store the tellings
 * ride) is shared by every isolate: assert() consults it before a call
 * spends, record() adds to it atomically. Store down or unconfigured
 * degrades to the local view — exactly the pre-durable behaviour,
 * never a blocked call the cap didn't earn.
 */

type DayEntry = { dollars: number; calls: number };

const LedgerKind = 'ledger';

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
  /** Throws BudgetExceededError at the cap — await BEFORE spending. */
  assert: () => Promise<void>;
  /** Test hook: the module-level ledger hydrates at import, so tests reset contents, not instances. */
  reset: () => void;
  /** Await it: a floating write dies with the isolate on Workers. */
  record: (dollars: number) => Promise<void>;
  /** The local (per-process) view — cheap, for log lines. */
  todays: () => DayEntry;
  /** The shared view: local merged with the durable ledger. */
  todaysDurable: () => Promise<DayEntry>;
  cap: () => number;
  /** Last week of daily spend, newest first, durable-merged. */
  recent: () => Promise<{ day: string; dollars: number; calls: number }[]>;
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

  // Both ledgers count the same spends: local sees only this isolate's,
  // durable sees every isolate's (including this one — record() writes
  // both). Max, not sum, or each spend would count twice.
  const merged = async (day: string): Promise<DayEntry> => {
    const local = ledger.get(day) ?? { dollars: 0, calls: 0 };
    const durable = await storeGet<DayEntry>(LedgerKind, `${ledgerName}:${day}`);
    if (!durable) {
      return local;
    }
    return {
      dollars: Math.max(local.dollars, durable.value.dollars),
      calls: Math.max(local.calls, durable.value.calls),
    };
  };

  return {
    cap,
    todays,
    todaysDurable: () => merged(dayKey()),
    reset: () => ledger.clear(),
    assert: async () => {
      // Replay-only: development servers set REPLAY_ONLY=1 and serve
      // recorded caches; a cache miss refuses rather than bills. The
      // real app never sets it. This is how dev work stays at zero.
      if (process.env.REPLAY_ONLY === '1') {
        throw new BudgetExceededError(`${provider} [replay-only dev mode]`, 0, 0);
      }
      const spent = await merged(dayKey());
      if (spent.dollars >= cap()) {
        throw new BudgetExceededError(provider, spent.dollars, cap());
      }
    },
    record: async (dollars: number) => {
      const key = dayKey();
      const entry = ledger.get(key) ?? { dollars: 0, calls: 0 };
      ledger.set(key, { dollars: entry.dollars + dollars, calls: entry.calls + 1 });
      await storeAdd(LedgerKind, `${ledgerName}:${key}`, dollars, Date.now());
    },
    recent: async () => {
      const days: { day: string; dollars: number; calls: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const entry = await merged(dayKey(date));
        if (entry.calls > 0 || entry.dollars > 0) {
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
