import { createClient, type Client } from '@libsql/client/web';

/**
 * The durable home for AI output. The per-process caches (ai-cache's
 * diskBackedMap) die with the worker on production edge runtimes —
 * no filesystem, isolates recycled constantly — so the "30-day"
 * telling cache was, in production, minutes long: the same stories
 * regenerated over and over, each one a free-tier call and seconds
 * of wait the first reader already paid.
 *
 * This store is Turso (hosted SQLite over HTTP — the one client that
 * runs on the Workers runtime). One table: (kind, key) → JSON value +
 * written-at. Configured entirely by env; ABSENT CONFIG IS A VALID
 * MODE — the store switches off and everything behaves exactly as
 * before this file existed.
 *
 * The iron rule, inherited from the budget breaker's caching law:
 * the store NEVER gates a read. Any error logs once and answers
 * "not stored"; writes never throw. Writes ARE awaited by callers —
 * fire-and-forget dies on Workers, which freeze the isolate the
 * moment the response returns and kill in-flight promises (proved in
 * production: generations answered, nothing landed in the table).
 * The ~100ms a write costs rides on responses that already spent
 * seconds generating.
 */

let client: Client | null | undefined;
let tableReady: Promise<unknown> | null = null;
let warned = false;

function warnOnce(error: unknown) {
  if (!warned) {
    warned = true;
    console.warn('[telling-store] unreachable — per-process caches only this session:', error);
  }
}

/**
 * The latch is released by the next success, not held for the
 * isolate's life. Latched forever, the SECOND incident an isolate
 * lived through was silent — and the only reason this warning exists
 * is that the edge runtime gives us no log to read after the fact.
 */
function noteSuccess() {
  warned = false;
}

/**
 * What a reader is allowed to hear about a failure. libsql's own text
 * names the database host (`libsql://venture-<org>.turso.io`) and it
 * rides out on a public, unauthenticated response header — a Turso
 * incident would hand anyone polling the feed the hostname and the
 * internal detail with it. Five words is all a reader needs to know
 * what to go and fix; the full text goes to the log, exactly as every
 * other route's error already does.
 */
export type StoreFailure = 'off' | 'auth' | 'timeout' | 'sql' | 'unknown';
export type StoreState = 'off' | 'ok' | 'error';

function classify(error: unknown): StoreFailure {
  // libsql hangs a code off its errors (SQLITE_UNKNOWN, SERVER_ERROR,
  // …); the text is the fallback for everything the fetch layer
  // throws before libsql sees it. Never match on 'sql' in the text —
  // "LibsqlError" and every libsql:// URL contain it.
  const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
  const text = String(error).toLowerCase();
  if (code.includes('AUTH') || /unauthor|forbidden|jwt|\b401\b|\b403\b/.test(text)) {
    return 'auth';
  }
  if (
    code.includes('TIMEOUT') ||
    /timeout|timed out|etimedout|econnreset|econnrefused|enotfound|aborted|fetch failed/.test(text)
  ) {
    return 'timeout';
  }
  if (code.startsWith('SQL') || /no such table|no such column|syntax error|constraint/.test(text)) {
    return 'sql';
  }
  return 'unknown';
}

/**
 * How long a failure keeps colouring the health headers. The store is
 * reached from inside the cache layers, which carry no request context
 * to scope this to, so a module global it must be — and a global that
 * the next success WIPES answers 'ok' at the exact moment a reader is
 * asking why nothing is cached (request A's failure cleared by request
 * B's success, in one isolate, before A ever wrote its headers). It
 * remembers instead: a blip inside the last minute is precisely the
 * thing these headers exist to show, and a store that fails one ask in
 * ten should not read as healthy nine times.
 */
const FailureMemoryMs = 60 * 1000;
let lastFailure: StoreFailure | null = null;
let lastFailureAt = 0;

function recordFailure(code: StoreFailure) {
  lastFailure = code;
  lastFailureAt = Date.now();
}

function resolveClient(): Client | null {
  if (client !== undefined) {
    return client;
  }
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    client = null;
    console.log('[telling-store] TURSO_DATABASE_URL unset — durable store off, per-process caches only');
    return client;
  }
  try {
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  } catch (error) {
    client = null;
    recordFailure(classify(error));
    warnOnce(error);
  }
  return client;
}

async function withTable(c: Client): Promise<void> {
  // A rejected first CREATE must not be memoized — one transient blip
  // would otherwise switch the store off for the isolate's whole life
  tableReady ??= c
    .execute(
      'CREATE TABLE IF NOT EXISTS tellings (' +
        'kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ' +
        'written_at INTEGER NOT NULL, PRIMARY KEY (kind, key))'
    )
    .catch((error) => {
      tableReady = null;
      throw error;
    });
  await tableReady;
}

/** A stored entry, or undefined for miss/off/error — all one answer. */
export async function storeGet<V>(
  kind: string,
  key: string
): Promise<{ value: V; at: number } | undefined> {
  const c = resolveClient();
  if (!c) {
    return undefined;
  }
  try {
    await withTable(c);
    const result = await c.execute({
      sql: 'SELECT value, written_at FROM tellings WHERE kind = ? AND key = ?',
      args: [kind, key],
    });
    const row = result.rows[0];
    noteSuccess();
    if (!row) {
      return undefined;
    }
    return { value: JSON.parse(String(row.value)) as V, at: Number(row.written_at) };
  } catch (error) {
    // Reads report too. Written only by storePut, this pair could not
    // see the one shape it was built for: reads failing while writes
    // succeed leaves every request recomposing, x-feed-cache: compose
    // forever, and NO error header at all, because the last good put
    // nulled it — the #231 blind spot exactly.
    recordFailure(classify(error));
    warnOnce(error);
    return undefined;
  }
}

/**
 * Why the store last refused, in the public vocabulary — or null when
 * nothing has gone wrong lately. The store answers "not stored" for
 * every failure by design, which is right for behaviour and blind for
 * diagnosis: the feed cache wrote nothing for hours on the edge with
 * no way to ask why, because this runtime has no log we can read.
 */
export function lastStoreError(): StoreFailure | null {
  if (lastFailure && Date.now() - lastFailureAt >= FailureMemoryMs) {
    lastFailure = null;
  }
  return lastFailure;
}

/**
 * What the store is doing right now: 'off' (unconfigured — a valid
 * mode, not a fault), 'error' (a read or a write failed inside the
 * memory window, or the client would not even build), 'ok'
 * (configured, and nothing has failed).
 */
export function storeState(): StoreState {
  if (!process.env.TURSO_DATABASE_URL) {
    return 'off';
  }
  if (client === null) {
    // Configured, but the client refused to build — broken for this
    // isolate's whole life, not a passing blip that ages out
    return 'error';
  }
  return lastStoreError() ? 'error' : 'ok';
}

/**
 * The two headers every store-backed route answers with. x-feed-store
 * is UNCONDITIONAL: absence used to mean "healthy" or "never asked"
 * with no way to tell them apart, which is how #231's store stayed
 * dead in production for a day with nobody able to prove it.
 */
export function storeHealthHeaders(): Record<string, string> {
  const failure = lastStoreError();
  return {
    'x-feed-store': storeState(),
    ...(failure ? { 'x-feed-store-error': failure } : {}),
  };
}

/** Never throws; await it so the platform can't kill it mid-flight. */
export async function storePut(
  kind: string,
  key: string,
  value: unknown,
  at: number
): Promise<void> {
  const c = resolveClient();
  if (!c) {
    // Only DROPPED WRITES record 'off'. A read against a store that
    // isn't there costs nothing and storeState() already says so; a
    // write that went nowhere is the thing somebody pays for later.
    recordFailure('off');
    return;
  }
  try {
    await withTable(c);
    await c.execute({
      sql:
        'INSERT INTO tellings (kind, key, value, written_at) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, written_at = excluded.written_at',
      args: [kind, key, JSON.stringify(value), at],
    });
    noteSuccess();
  } catch (error) {
    recordFailure(classify(error));
    warnOnce(error);
  }
}

/**
 * Atomically add to a durable counter — the day-ledger's write path.
 * One SQL statement, so concurrent isolates never lose each other's
 * increments the way read-modify-write would. Value shape matches the
 * ledger's DayEntry: {"dollars": n, "calls": n}. Never throws.
 */
export async function storeAdd(
  kind: string,
  key: string,
  dollars: number,
  at: number
): Promise<void> {
  const c = resolveClient();
  if (!c) {
    recordFailure('off');
    return;
  }
  try {
    await withTable(c);
    await c.execute({
      sql:
        'INSERT INTO tellings (kind, key, value, written_at) ' +
        "VALUES (?, ?, json_object('dollars', ?, 'calls', 1), ?) " +
        'ON CONFLICT(kind, key) DO UPDATE SET value = json_object(' +
        "'dollars', json_extract(tellings.value, '$.dollars') + ?, " +
        "'calls', json_extract(tellings.value, '$.calls') + 1), " +
        'written_at = excluded.written_at',
      args: [kind, key, dollars, at, dollars],
    });
    noteSuccess();
  } catch (error) {
    // The durable ledger rides this path: a dead store quietly reverts
    // the shared 300/day cap to 300 per isolate lifetime, so its
    // failures belong in the headers as much as the feed's do
    recordFailure(classify(error));
    warnOnce(error);
  }
}

/** Tests only: module state must not leak between them. */
export function resetTellingStoreForTests() {
  client = undefined;
  tableReady = null;
  warned = false;
  lastFailure = null;
  lastFailureAt = 0;
}
