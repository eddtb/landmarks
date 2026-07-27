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
