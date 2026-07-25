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
 * "not stored"; writes are fire-and-forget. Couldn't-reach-the-store
 * must be indistinguishable from a store miss.
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
    warnOnce(error);
  }
  return client;
}

async function withTable(c: Client): Promise<void> {
  tableReady ??= c.execute(
    'CREATE TABLE IF NOT EXISTS tellings (' +
      'kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, ' +
      'written_at INTEGER NOT NULL, PRIMARY KEY (kind, key))'
  );
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
    if (!row) {
      return undefined;
    }
    return { value: JSON.parse(String(row.value)) as V, at: Number(row.written_at) };
  } catch (error) {
    warnOnce(error);
    return undefined;
  }
}

/** Fire-and-forget: a failed write never delays or breaks the answer. */
export function storePut(kind: string, key: string, value: unknown, at: number): void {
  const c = resolveClient();
  if (!c) {
    return;
  }
  void (async () => {
    try {
      await withTable(c);
      await c.execute({
        sql:
          'INSERT INTO tellings (kind, key, value, written_at) VALUES (?, ?, ?, ?) ' +
          'ON CONFLICT(kind, key) DO UPDATE SET value = excluded.value, written_at = excluded.written_at',
        args: [kind, key, JSON.stringify(value), at],
      });
    } catch (error) {
      warnOnce(error);
    }
  })();
}

/** Tests only: module state must not leak between them. */
export function resetTellingStoreForTests() {
  client = undefined;
  tableReady = null;
  warned = false;
}
