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
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    const map = persistedMap<string>('failing', HourMs);
    map.set('k', 'v');
    await expect(map.flush()).resolves.toBeUndefined(); // swallowed
    expect(map.get('k')).toBe('v'); // in-memory service unaffected
  });
});
