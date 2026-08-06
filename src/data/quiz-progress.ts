import { useSyncExternalStore } from 'react';

import { persistedMap } from '@/data/persisted-cache';

/**
 * What the ground remembers of the quizzer. One never-expiring blob
 * mapping area name → the running tally, entirely on-device (the
 * journal's shape, for the journal's reasons: persistedMap has no
 * delete, so the record must be rewritable as a whole).
 *
 * Ranks climb with CUMULATIVE right answers in an area, not the last
 * run's score: the feed shifts as you walk and the server re-sets the
 * quiz monthly, so the same ground keeps producing new questions — the
 * rank is for learning the place, not for one lucky hand. Movement
 * never busts this record; it is about the reader, not their position.
 */

export const Ranks = ['Stranger', 'Visitor', 'Local', 'Historian'] as const;
export type Rank = (typeof Ranks)[number];

/** The climb: one clean run makes Visitor, three make Local, and
 *  Historian is earned across many, or a fortnight of perfect ones. */
const RankFloors: Record<Rank, number> = {
  Stranger: 0,
  Visitor: 5,
  Local: 15,
  Historian: 30,
};

export type AreaProgress = {
  /** Right answers, all-time, in this area. */
  correct: number;
  /** Runs finished, all-time. */
  runs: number;
  /** The best single run, as "correct/total". */
  best: { correct: number; total: number } | null;
};

type ProgressRecord = Record<string, AreaProgress>;

// Infinity TTL: the pruner must never eat the reader's standing
const store = persistedMap<ProgressRecord>('quiz-progress-v1', Infinity);
const RecordKey = 'areas';

let areas: ProgressRecord | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

void store.hydrated.then(() => {
  if (areas === null) {
    areas = store.peek(RecordKey)?.value ?? {};
    notify();
  }
});

/** The rank a tally has earned. */
export function rankFor(correct: number): Rank {
  let earned: Rank = 'Stranger';
  for (const rank of Ranks) {
    if (correct >= RankFloors[rank]) {
      earned = rank;
    }
  }
  return earned;
}

/** Case-insensitive: "Greenwich" and "greenwich" are one ground. */
function areaKey(areaName: string): string {
  return areaName.trim().toLowerCase();
}

/**
 * A finished run's tally, added to the area's record. Applied after
 * hydration if the run beat it — a finished quiz only ever adds.
 */
export function recordRun(areaName: string, correct: number, total: number) {
  const key = areaKey(areaName);
  if (!key || total <= 0) {
    return;
  }
  const apply = () => {
    const current = areas ?? {};
    const previous = current[key] ?? { correct: 0, runs: 0, best: null };
    const best =
      !previous.best || correct / total > previous.best.correct / previous.best.total
        ? { correct, total }
        : previous.best;
    areas = {
      ...current,
      [key]: { correct: previous.correct + correct, runs: previous.runs + 1, best },
    };
    store.set(RecordKey, areas);
    notify();
  };
  if (areas === null) {
    void store.hydrated.then(apply);
  } else {
    apply();
  }
}

/** The record, or undefined for ground never quizzed (or pre-hydration). */
export function areaProgress(areaName: string): AreaProgress | undefined {
  return areas?.[areaKey(areaName)];
}

export function useAreaProgress(areaName: string): AreaProgress | undefined {
  return useSyncExternalStore(
    subscribe,
    () => areaProgress(areaName),
    () => areaProgress(areaName)
  );
}

/** Tests only: the store is module-level and must not leak between them. */
export function setQuizProgressForTests(next: ProgressRecord | null) {
  areas = next;
  notify();
}
