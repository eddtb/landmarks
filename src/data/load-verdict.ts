import { ApiError } from '@/data/cached-get';

/**
 * Whose silence this is: the record's, Venture's, or the phone's.
 *
 * The gazetteer used to have no way to ask. Both article legs ended in
 * `.catch(() => null)`, so a 502, a timeout and a genuine 404 arrived
 * as the same `null`, set `articleStatus = 'none'`, and printed "No
 * recorded story for this area yet" — a claim about the historical
 * record, made because a worker was recycling (#291).
 *
 * The distinction is `use-area-name.ts`'s, lifted out and generalised:
 * only a 404 is a verdict of nonexistence.
 */
export type LoadVerdict =
  /** 404: the record's own fact. The ask worked and there is nothing there. */
  | 'absent'
  /** Nothing came back at all — a timeout, an abort, a dropped socket. */
  | 'silent'
  /** Something came back and it was an error: a 5xx, an unreadable payload. */
  | 'errored'
  /** The request never left the phone, so we know nothing about the record. */
  | 'offline';

/**
 * Rank, so two legs fold into one honest answer (`worstOf`). Absence
 * sits LOWEST on purpose: it is the strongest claim on this list — a
 * statement about history rather than about a request — so it survives
 * only when every leg agrees on it. Offline sits highest because it
 * outranks everything: with no request on the wire, nothing else on
 * this screen knows anything.
 */
const Rank: Record<LoadVerdict, number> = { absent: 0, silent: 1, errored: 2, offline: 3 };

/**
 * One failed ask, read honestly. `offline` is the phone's own answer
 * (the feed fell back to its saved copy) and outranks whatever the
 * error object happens to be.
 */
export function loadVerdict(error: unknown, offline = false): LoadVerdict {
  if (offline) {
    return 'offline';
  }
  if (error instanceof ApiError) {
    return error.status === 404 ? 'absent' : 'errored';
  }
  // A rejected fetch never reached a status: nothing came back.
  return 'silent';
}

/** Two legs, one verdict. Absence needs unanimity; everything else wins. */
export function worstOf(first: LoadVerdict, second: LoadVerdict): LoadVerdict {
  return Rank[first] >= Rank[second] ? first : second;
}
