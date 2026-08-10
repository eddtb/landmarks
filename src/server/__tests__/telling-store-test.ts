/**
 * The store's iron rule under test: it NEVER gates a read. Off,
 * unreachable, or corrupt all answer exactly like a miss.
 */

const mockExecute = jest.fn();
const mockCreateClient = jest.fn(() => ({ execute: mockExecute }));

jest.mock('@libsql/client/web', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...(args as [])),
}));

type StoreModule = typeof import('@/server/telling-store');

function loadStore(env: { url?: string; token?: string }): StoreModule {
  jest.resetModules();
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  if (env.url) {
    process.env.TURSO_DATABASE_URL = env.url;
  }
  if (env.token) {
    process.env.TURSO_AUTH_TOKEN = env.token;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/server/telling-store') as StoreModule;
}

beforeEach(() => {
  mockExecute.mockReset();
  mockCreateClient.mockClear();
});

describe('telling-store', () => {
  test('without TURSO_DATABASE_URL the store is OFF: miss on read, no-op on write, no client', async () => {
    const store = loadStore({});

    expect(await store.storeGet('telling', '42')).toBeUndefined();
    store.storePut('telling', '42', { text: 'x' }, 1);

    expect(mockCreateClient).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  test('a stored row comes back parsed, with its written-at', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io', token: 't' });
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
      .mockResolvedValueOnce({
        rows: [{ value: JSON.stringify({ text: 'Kept words.' }), written_at: 1700000000000 }],
      });

    const entry = await store.storeGet<{ text: string }>('telling', '42');

    expect(entry).toEqual({ value: { text: 'Kept words.' }, at: 1700000000000 });
    expect(mockCreateClient).toHaveBeenCalledWith({ url: 'libsql://test.turso.io', authToken: 't' });
    // The read used bound args, not string interpolation
    expect(mockExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({ args: ['telling', '42'] })
    );
  });

  test('no row is a plain miss', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });

    expect(await store.storeGet('retold', 'greenwich')).toBeUndefined();
  });

  test('an unreachable store answers like a miss and never throws', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await expect(store.storeGet('telling', '42')).resolves.toBeUndefined();
    // The write is awaited by callers (Workers kill floating promises
    // after the response) but must still never reject
    await expect(store.storePut('telling', '42', { text: 'x' }, 1)).resolves.toBeUndefined();
  });

  test('a corrupt stored value answers like a miss', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: 'not json {', written_at: 1 }] });

    expect(await store.storeGet('telling', '42')).toBeUndefined();
  });

  test('a write upserts under (kind, key) with bound args', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockResolvedValue({ rows: [] });

    await store.storePut('retold', 'greenwich', { retold: null }, 1700000000000);

    expect(mockExecute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        args: ['retold', 'greenwich', JSON.stringify({ retold: null }), 1700000000000],
      })
    );
  });

  test('a failed first CREATE TABLE is not remembered — the next call retries it', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute
      .mockRejectedValueOnce(new Error('transient blip')) // CREATE TABLE fails once
      .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE retried
      .mockResolvedValueOnce({ rows: [{ value: JSON.stringify({ text: 'Alive.' }), written_at: 5 }] });

    expect(await store.storeGet('telling', '42')).toBeUndefined();
    // A memoized rejection would leave the store off for the isolate's
    // life; the retry must reach the table and read through
    expect(await store.storeGet<{ text: string }>('telling', '42')).toEqual({
      value: { text: 'Alive.' },
      at: 5,
    });
  });

  test('storeAdd increments atomically in one statement and never throws', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockResolvedValue({ rows: [] });

    await store.storeAdd('ledger', 'gemini-call-ledger:2026-07-27', 1, 1700000000000);

    const call = mockExecute.mock.calls.at(-1)?.[0] as { sql: string; args: unknown[] };
    // One upsert, no read-modify-write — concurrent isolates must not
    // lose each other's increments
    expect(call.sql).toContain('ON CONFLICT(kind, key) DO UPDATE');
    expect(call.sql).toContain("json_extract(tellings.value, '$.dollars') + ?");
    expect(call.args).toEqual(['ledger', 'gemini-call-ledger:2026-07-27', 1, 1700000000000, 1]);

    mockExecute.mockRejectedValue(new Error('gone away'));
    await expect(store.storeAdd('ledger', 'k', 1, 2)).resolves.toBeUndefined();
  });
});

/**
 * The health a public, unauthenticated response header is allowed to
 * carry. Two failures hid in the old pair: it watched only writes, so a
 * store whose READS were broken read as healthy while every request
 * recomposed; and it echoed libsql's own text, which names the database
 * host, to whoever asked.
 */
describe('store health', () => {
  test('a READ failure colours the health, not just a write', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockRejectedValue(new Error('connect ETIMEDOUT'));

    await store.storeGet('telling', '42');

    // Reads failing while writes succeed is the #231 shape: every
    // request recomposes and the old header stayed silent throughout
    expect(store.storeState()).toBe('error');
    expect(store.lastStoreError()).toBe('timeout');
  });

  test('the vocabulary is five fixed words — libsql never speaks to the caller', async () => {
    const cases: [unknown, string][] = [
      [new Error('SERVER_ERROR: unauthorized: the JWT is expired'), 'auth'],
      [new Error('connect ETIMEDOUT libsql://venture-edd.turso.io'), 'timeout'],
      [new Error('SQLITE_UNKNOWN: SQLite error: no such table: tellings'), 'sql'],
      [new Error('something nobody has seen before'), 'unknown'],
    ];

    for (const [thrown, expected] of cases) {
      const store = loadStore({ url: 'libsql://venture-edd.turso.io' });
      mockExecute.mockRejectedValue(thrown);

      await store.storeGet('telling', '42');

      expect(store.lastStoreError()).toBe(expected);
      // The whole point: a Turso incident must not hand anyone polling
      // the feed the database hostname along with it
      expect(JSON.stringify(store.storeHealthHeaders())).not.toContain('turso');
    }
  });

  test('storeState tells "never configured" apart from "configured and broken"', async () => {
    const off = loadStore({});
    expect(off.storeState()).toBe('off');
    expect(off.storeHealthHeaders()).toEqual({ 'x-feed-store': 'off' });

    const healthy = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockResolvedValue({ rows: [] });
    await healthy.storeGet('telling', '42');
    expect(healthy.storeState()).toBe('ok');

    const broken = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockRejectedValue(new Error('no such table: tellings'));
    await broken.storeGet('telling', '42');
    expect(broken.storeState()).toBe('error');
  });

  test('a write dropped because the store is off is remembered as off', async () => {
    const store = loadStore({});

    await store.storePut('telling', '42', { text: 'x' }, 1);

    // A read against a store that isn't there costs nothing; a write
    // that went nowhere is what somebody pays for later
    expect(store.lastStoreError()).toBe('off');
  });

  test('a later success does not wipe the failure another answer is about to report', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockRejectedValue(new Error('connect ETIMEDOUT'));
    await store.storeGet('telling', '42');

    mockExecute.mockReset();
    mockExecute.mockResolvedValue({ rows: [] });
    await store.storePut('telling', '43', { text: 'x' }, 1);

    // Request B's success clearing request A's failure is how a store
    // failing one ask in ten used to read as healthy nine times
    expect(store.storeState()).toBe('error');
    expect(store.lastStoreError()).toBe('timeout');
  });

  test('the health ages out, so a blip does not condemn the isolate for life', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockRejectedValue(new Error('connect ETIMEDOUT'));
    await store.storeGet('telling', '42');
    expect(store.storeState()).toBe('error');

    const later = Date.now() + 61_000;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(later);
    try {
      expect(store.storeState()).toBe('ok');
      expect(store.lastStoreError()).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  test('the warn latch releases on the next success, so a second incident still logs', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockExecute.mockRejectedValue(new Error('first outage'));
      await store.storeGet('telling', '42');
      expect(warn).toHaveBeenCalledTimes(1);

      mockExecute.mockReset();
      mockExecute.mockResolvedValue({ rows: [] });
      await store.storeGet('telling', '42');

      mockExecute.mockReset();
      mockExecute.mockRejectedValue(new Error('second outage'));
      await store.storeGet('telling', '42');

      // Latched for the isolate's life, the SECOND incident was silent
      // — and this runtime leaves no log to read after the fact
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  test('x-feed-store rides every answer; the error word only joins when there is one', async () => {
    const store = loadStore({ url: 'libsql://test.turso.io' });
    mockExecute.mockResolvedValue({ rows: [] });
    await store.storeGet('telling', '42');

    // Absence used to mean "healthy" or "never asked", with no way to
    // tell them apart — which is how #231 stayed invisible for a day
    expect(store.storeHealthHeaders()).toEqual({ 'x-feed-store': 'ok' });

    mockExecute.mockReset();
    mockExecute.mockRejectedValue(new Error('unauthorized'));
    await store.storeGet('telling', '42');

    expect(store.storeHealthHeaders()).toEqual({
      'x-feed-store': 'error',
      'x-feed-store-error': 'auth',
    });
  });
});
