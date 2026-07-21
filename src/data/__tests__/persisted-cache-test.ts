import AsyncStorage from '@react-native-async-storage/async-storage';

import { dropPersistedMapForTests, persistedMap } from '@/data/persisted-cache';

const HourMs = 60 * 60 * 1000;

/** The official mock's in-memory store — reached fresh each time
 * because clear() swaps the object out from under a captured ref. */
function raw(): Record<string, string> {
  return (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
    .__INTERNAL_MOCK_STORAGE__;
}

/**
 * The cache's whole job is surviving the process: entries written
 * before a force-quit must hydrate after it. Simulated (ai-cache-test's
 * technique) by dropping the live instance and re-creating from storage.
 */
describe('persistedMap round-trip', () => {
  test('entries survive a simulated process restart', async () => {
    const map = persistedMap<string[]>('rt', HourMs);
    map.set('51.5045|-0.0905', ['Borough Compter']);
    await map.flush();
    expect(raw()['cache-rt-v1']).toBeDefined();

    // "Restart": drop the live instance, hydrate fresh from storage
    dropPersistedMapForTests('rt');
    const rehydrated = persistedMap<string[]>('rt', HourMs);
    await rehydrated.hydrated;
    expect(rehydrated.get('51.5045|-0.0905')).toEqual(['Borough Compter']);
  });

  test('same name returns the same live instance', () => {
    const a = persistedMap<number>('same', HourMs);
    const b = persistedMap<number>('same', HourMs);
    a.set('k', 7);
    expect(b.get('k')).toBe(7);
    expect(a).toBe(b);
  });
});

describe('persistedMap TTL', () => {
  test('an expired entry is peekable but never served as live', async () => {
    raw()['cache-ttl-v1'] = JSON.stringify([
      ['bucket', { value: 'old answer', at: Date.now() - 60_000 }],
    ]);
    const map = persistedMap<string>('ttl', 1000);
    await map.hydrated;

    expect(map.get('bucket')).toBeUndefined(); // stale: not a substitute
    expect(map.values()).toEqual([]); // live views exclude it too
    expect(map.peek('bucket')?.value).toBe('old answer'); // placeholder material
    expect(map.peek('bucket')?.at).toBeLessThan(Date.now() - 1000);

    map.set('bucket', 'fresh answer'); // re-asking overwrites in place
    expect(map.get('bucket')).toBe('fresh answer');
  });
});

/**
 * The clobber regression, inherited from ai-cache: writers sharing one
 * store may only add, never destroy. Simulated by writing a "foreign"
 * entry straight to storage after hydration — the flush must keep it.
 */
describe('persistedMap merge-on-write', () => {
  test("another writer's entries survive this instance's flush", async () => {
    const map = persistedMap<string>('merge', HourMs);
    await map.hydrated;
    map.set('ours', 'from this process');

    raw()['cache-merge-v1'] = JSON.stringify([
      ['theirs', { value: 'from the other process', at: Date.now() }],
      ['ours', { value: 'their stale copy', at: Date.now() }],
    ]);

    map.set('ours-2', 'trigger a flush');
    await map.flush();

    const onDisk = new Map(
      JSON.parse(raw()['cache-merge-v1']) as [string, { value: string }][]
    );
    expect(onDisk.get('theirs')?.value).toBe('from the other process'); // preserved
    expect(onDisk.get('ours')?.value).toBe('from this process'); // in-memory wins for our keys
    expect(onDisk.get('ours-2')?.value).toBe('trigger a flush');
  });

  test('two live instances flushing in turn both land', async () => {
    const a = persistedMap<number>('two', HourMs);
    dropPersistedMapForTests('two'); // so the next call really is a second instance
    const b = persistedMap<number>('two', HourMs);
    a.set('a', 1);
    b.set('b', 2);
    await a.flush();
    await b.flush(); // must fold a's entry in, not erase it

    const onDisk = new Map(JSON.parse(raw()['cache-two-v1']) as [string, { value: number }][]);
    expect(onDisk.get('a')?.value).toBe(1);
    expect(onDisk.get('b')?.value).toBe(2);
  });
});

/**
 * The forgetting rule: without a cutoff a walking app mints a new
 * persisted ~11m bucket every block, forever, into AsyncStorage's
 * ~6MB Android ceiling. Entries older than 2× the TTL leave storage
 * on write-back; between TTL and 2×TTL they survive as peek material.
 */
describe('persistedMap pruning', () => {
  test('an entry past 2×TTL leaves storage on flush; a recently-expired one survives', async () => {
    raw()['cache-prune-v1'] = JSON.stringify([
      ['ancient', { value: 'older than 2×TTL', at: Date.now() - 3000 }],
      ['recent', { value: 'between TTL and 2×TTL', at: Date.now() - 1500 }],
    ]);
    const map = persistedMap<string>('prune', 1000);
    await map.hydrated;
    map.set('live', 'now');
    await map.flush();

    const onDisk = new Map(JSON.parse(raw()['cache-prune-v1']) as [string, { value: string }][]);
    expect(onDisk.has('ancient')).toBe(false); // forgotten
    expect(onDisk.get('recent')?.value).toBe('between TTL and 2×TTL'); // kept
    expect(onDisk.get('live')?.value).toBe('now');
    expect(map.peek('recent')?.value).toBe('between TTL and 2×TTL'); // still placeholder material
    expect(map.get('recent')).toBeUndefined(); // but never live
  });

  test("the merge fold does not resurrect what another writer pruned", async () => {
    const map = persistedMap<string>('prune2', 1000);
    await map.hydrated;
    map.set('ours', 'from this process');

    // An ancient foreign entry lands in storage after hydration — the
    // flush's fold must apply the same cutoff, not resurrect it
    raw()['cache-prune2-v1'] = JSON.stringify([
      ['ancient-foreign', { value: 'x', at: Date.now() - 3000 }],
      ['fresh-foreign', { value: 'y', at: Date.now() }],
    ]);
    await map.flush();

    const onDisk = new Map(JSON.parse(raw()['cache-prune2-v1']) as [string, { value: string }][]);
    expect(onDisk.has('ancient-foreign')).toBe(false); // stayed dead
    expect(onDisk.get('fresh-foreign')?.value).toBe('y'); // add-never-destroy still holds
    expect(onDisk.get('ours')?.value).toBe('from this process');
  });
});

describe('persistedMap background flush', () => {
  test('backgrounding flushes the pending debounced write', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AppState } = require('react-native') as typeof import('react-native');
    const listeners = jest.spyOn(AppState, 'addEventListener');

    const map = persistedMap<string>('bg', HourMs);
    map.set('k', 'v');
    expect(raw()['cache-bg-v1']).toBeUndefined(); // debounced — not yet written

    const handler = listeners.mock.calls.at(-1)![1];
    handler('background');
    await map.flush(); // ride the write the handler kicked off

    const onDisk = new Map(JSON.parse(raw()['cache-bg-v1']) as [string, { value: string }][]);
    expect(onDisk.get('k')?.value).toBe('v');
    listeners.mockRestore();
  });
});

describe('persistedMap corruption and failure tolerance', () => {
  test('garbage JSON hydrates as an empty map, no throw', async () => {
    raw()['cache-bad-v1'] = 'not json {{{';
    const map = persistedMap<string>('bad', HourMs);
    await map.hydrated;
    expect(map.get('anything')).toBeUndefined();

    // And the store heals on the next good write
    map.set('k', 'v');
    await map.flush();
    dropPersistedMapForTests('bad');
    const healed = persistedMap<string>('bad', HourMs);
    await healed.hydrated;
    expect(healed.get('k')).toBe('v');
  });

  test('well-formed JSON of the wrong shape also reads as empty', async () => {
    raw()['cache-shape-v1'] = JSON.stringify({ not: 'an array' });
    raw()['cache-shape2-v1'] = JSON.stringify([['key-without-entry', 'bare string']]);
    const map = persistedMap<string>('shape', HourMs);
    const map2 = persistedMap<string>('shape2', HourMs);
    await Promise.all([map.hydrated, map2.hydrated]);
    expect(map.values()).toEqual([]);
    expect(map2.values()).toEqual([]);
  });

  test('a failing storage layer never surfaces to callers', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const map = persistedMap<string>('failing', HourMs);
    map.set('k', 'v');
    await expect(map.flush()).resolves.toBeUndefined(); // swallowed
    expect(map.get('k')).toBe('v'); // in-memory service unaffected
    warn.mockRestore();
  });

  test('a dead store warns once per session — visible in dev, never a throw', async () => {
    // The Android 6MB-ceiling failure mode: every setItem throws and
    // persistence is silently gone. One console.warn makes it visible.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    (AsyncStorage.setItem as jest.Mock)
      .mockRejectedValueOnce(new Error('SQLITE_FULL'))
      .mockRejectedValueOnce(new Error('SQLITE_FULL'));

    const map = persistedMap<string>('dead', HourMs);
    map.set('a', '1');
    await map.flush();
    map.set('b', '2');
    await map.flush();

    const deadStoreWarns = warn.mock.calls.filter((call) =>
      String(call[0]).includes("write-back failed for 'dead'")
    );
    expect(deadStoreWarns).toHaveLength(1); // once, not per write
    expect(map.get('b')).toBe('2'); // in-memory service unaffected
    warn.mockRestore();
  });
});

/**
 * The size bound, sibling of the age bound above: Android's
 * AsyncStorage ships a ~6MB ceiling, and an uncapped feed store was
 * measured killing persistence after ~50 walked buckets. Oldest-written
 * entries leave first once a capped map is over its maxEntries.
 */
describe('persistedMap LRU cap', () => {
  test('set evicts the oldest-written entry beyond the cap', async () => {
    const now = jest.spyOn(Date, 'now');
    const base = 1_700_000_000_000;
    now.mockReturnValue(base);
    const map = persistedMap<string>('cap', HourMs, { maxEntries: 2 });
    await map.hydrated;

    map.set('first', 'oldest');
    now.mockReturnValue(base + 1000);
    map.set('second', 'newer');
    now.mockReturnValue(base + 2000);
    map.set('third', 'newest'); // over cap — 'first' must go

    expect(map.get('first')).toBeUndefined();
    expect(map.get('second')).toBe('newer');
    expect(map.get('third')).toBe('newest');

    await map.flush();
    const onDisk = new Map(JSON.parse(raw()['cache-cap-v1']) as [string, { value: string }][]);
    expect(onDisk.size).toBe(2); // the cap holds on disk too
    expect(onDisk.has('first')).toBe(false);
    now.mockRestore();
  });

  test('hydrating an over-cap legacy store trims to the cap, oldest first', async () => {
    raw()['cache-cap2-v1'] = JSON.stringify([
      ['old', { value: 'from last month', at: Date.now() - 3000 }],
      ['mid', { value: 'yesterday', at: Date.now() - 2000 }],
      ['new', { value: 'just now', at: Date.now() }],
    ]);
    const map = persistedMap<string>('cap2', HourMs, { maxEntries: 2 });
    await map.hydrated;

    expect(map.peek('old')).toBeUndefined(); // evicted on arrival
    expect(map.peek('mid')?.value).toBe('yesterday');
    expect(map.peek('new')?.value).toBe('just now');
  });
});

/**
 * The fold-once invariant (see the module header): each named map is a
 * process singleton and RN runs one app process, so foreign writes can
 * only surface at the hydration boundary. The first write-back folds
 * storage in; every later one skips the whole-store getItem+parse —
 * that parse was measured at ~100-170ms of phone JS thread per
 * debounced write while walking.
 */
describe('persistedMap fold-once', () => {
  function getItemCallsFor(storageKey: string): number {
    return (AsyncStorage.getItem as jest.Mock).mock.calls.filter(
      (call) => call[0] === storageKey
    ).length;
  }

  test('the whole-store re-read happens on the first write-back only', async () => {
    const map = persistedMap<string>('fold', HourMs);
    await map.hydrated;
    const afterHydration = getItemCallsFor('cache-fold-v1');

    map.set('a', '1');
    await map.flush();
    expect(getItemCallsFor('cache-fold-v1')).toBe(afterHydration + 1); // the one fold

    map.set('b', '2');
    await map.flush();
    map.set('c', '3');
    await map.flush();
    expect(getItemCallsFor('cache-fold-v1')).toBe(afterHydration + 1); // never again

    // And nothing was lost to the skipped folds
    const onDisk = new Map(JSON.parse(raw()['cache-fold-v1']) as [string, { value: string }][]);
    expect([...onDisk.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  test('a write-back racing hydration still folds the persisted entries in', async () => {
    // Set + flush immediately, without awaiting hydration — the flush
    // must not clobber last session's entries with just its own.
    raw()['cache-race-v1'] = JSON.stringify([
      ['last-session', { value: 'persisted before this process', at: Date.now() }],
    ]);
    const map = persistedMap<string>('race', HourMs);
    map.set('this-session', 'written before hydration resolved');
    await map.flush();

    const onDisk = new Map(JSON.parse(raw()['cache-race-v1']) as [string, { value: string }][]);
    expect(onDisk.get('last-session')?.value).toBe('persisted before this process');
    expect(onDisk.get('this-session')?.value).toBe('written before hydration resolved');
  });
});
