import { diskBackedMap, flushDiskMapsForTests } from '@/server/ai-cache';

// Same guarded require the module itself uses — the app tsconfig has
// no node types, and this test only runs under node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync, readFileSync, writeFileSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  rmSync: (path: string) => void;
  readFileSync: (path: string, encoding: 'utf8') => string;
  writeFileSync: (path: string, data: string) => void;
};

/** The simulated process restart: drop the live instance so the next
 * diskBackedMap call has nothing but the file to build from. */
function restart(name: string) {
  (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete(name);
  (globalThis as { aiDiskPolicies?: Map<string, unknown> }).aiDiskPolicies?.delete(name);
}

function diskEntries(path: string): Map<string, unknown> {
  return new Map(JSON.parse(readFileSync(path, 'utf8')) as [string, unknown][]);
}

/**
 * The cache's whole job is surviving the process: entries written
 * before a dev-server restart must hydrate after it. Simulated here
 * by dropping the in-memory instance and re-creating from disk.
 */
describe('diskBackedMap', () => {
  const name = 'test-suite-cache';
  const path = `${process.env.AI_CACHE_DIR}/${name}.json`;

  afterAll(() => {
    if (existsSync(path)) {
      rmSync(path);
    }
  });

  test('entries survive a simulated process restart', async () => {
    const map = diskBackedMap<{ events: string[] }>(name);
    map.set('venue-1', { events: ['Quiz night'] });

    // The write is debounced 2s — wait it out
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(existsSync(path)).toBe(true);

    // "Restart": drop the in-memory instance, hydrate fresh from disk
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete(name);
    const rehydrated = diskBackedMap<{ events: string[] }>(name);
    expect(rehydrated.get('venue-1')).toEqual({ events: ['Quiz night'] });
  });

  test('same name returns the same live instance', () => {
    const a = diskBackedMap<number>(name);
    const b = diskBackedMap<number>(name);
    a.set('k', 7);
    expect(b.get('k')).toBe(7);
  });
});

/**
 * The clobber regression: two processes sharing .ai-cache must never
 * erase each other's entries. Simulated by writing a "foreign" entry
 * straight to disk after hydration — the next flush must keep it.
 */
describe('diskBackedMap merge-on-write', () => {
  const name = 'test-merge-cache';
  const path = `${process.env.AI_CACHE_DIR}/${name}.json`;

  afterAll(() => {
    if (existsSync(path)) {
      rmSync(path);
    }
  });

  test("another process's entries survive this process's flush", async () => {
    const map = diskBackedMap<string>(name);
    map.set('ours', 'from this process');

    // Another process writes its own entry (plus a stale copy of ours)
    // AFTER we hydrated — the old code would erase it on flush
    writeFileSync(
      path,
      JSON.stringify([
        ['theirs', 'from the other process'],
        ['ours', 'their stale copy'],
      ])
    );

    map.set('ours-2', 'trigger a flush');
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const onDisk = new Map(JSON.parse(readFileSync(path, 'utf8')) as [string, string][]);
    expect(onDisk.get('theirs')).toBe('from the other process'); // preserved, not clobbered
    expect(onDisk.get('ours')).toBe('from this process'); // in-memory wins for our keys
    expect(onDisk.get('ours-2')).toBe('trigger a flush');
  });
});

/**
 * Forgetting, the half these maps never had (#246). Three ways an
 * entry must leave — age, the cap, and being deleted — and all three
 * are only real if they survive the rehydrate. A delete that lives in
 * memory alone is not a delete: the entry comes back with the next
 * process, which is how quiz.ts's invalidation and spend-budget's
 * ledger reset were both quietly no-ops.
 */
describe('diskBackedMap forgetting', () => {
  const Ttl = 60 * 60 * 1000;
  const paths: string[] = [];

  function probe(name: string): string {
    const path = `${process.env.AI_CACHE_DIR}/${name}.json`;
    paths.push(path);
    restart(name);
    return path;
  }

  afterAll(() => {
    for (const path of paths) {
      if (existsSync(path)) {
        rmSync(path);
      }
    }
  });

  test('an expired entry never survives the hydrate — it is gone before any caller asks', () => {
    const name = 'forget-expiry';
    const path = probe(name);
    writeFileSync(
      path,
      JSON.stringify([
        ['stale', { value: 'composed two hours ago', at: Date.now() - 2 * Ttl }],
        ['live', { value: 'composed just now', at: Date.now() }],
      ])
    );

    const map = diskBackedMap<{ value: string; at: number }>(name, { ttlMs: Ttl });

    expect(map.has('stale')).toBe(false);
    expect(map.size).toBe(1);
    expect(map.get('live')?.value).toBe('composed just now');
  });

  test('the cap evicts the oldest-written entry, and the cap holds on disk too', () => {
    const name = 'forget-cap';
    const path = probe(name);
    const map = diskBackedMap<{ value: string; at: number }>(name, { maxEntries: 2 });

    map.set('first', { value: 'oldest', at: 1000 });
    map.set('second', { value: 'newer', at: 2000 });
    map.set('third', { value: 'newest', at: 3000 }); // over the cap

    expect(map.has('first')).toBe(false);
    expect([...map.keys()]).toEqual(['second', 'third']);

    flushDiskMapsForTests();
    expect(diskEntries(path).size).toBe(2);
    expect(diskEntries(path).has('first')).toBe(false);
  });

  test('a deleted entry is gone from disk, and STAYS gone across a restart', () => {
    const name = 'forget-delete';
    const path = probe(name);
    const map = diskBackedMap<string>(name);
    map.set('keep', 'wanted');
    map.set('drop', 'poisoned entry, invalidated by its route');
    flushDiskMapsForTests();
    expect(diskEntries(path).has('drop')).toBe(true); // it really was persisted

    expect(map.delete('drop')).toBe(true);
    flushDiskMapsForTests();

    // What the NEXT process gets, which is the only thing that matters
    expect(diskEntries(path).has('drop')).toBe(false);
    restart(name);
    const rehydrated = diskBackedMap<string>(name);
    expect(rehydrated.get('drop')).toBeUndefined();
    expect(rehydrated.get('keep')).toBe('wanted');
  });

  test("a delete is not undone by the stale file it was deleted from", () => {
    // The merge fold exists so concurrent writers may only add — but a
    // key this process deleted must not ride back in on another
    // process's older copy of the same file.
    const name = 'forget-delete-fold';
    const path = probe(name);
    const map = diskBackedMap<string>(name);
    map.set('drop', 'to be invalidated');
    map.set('keep', 'wanted');
    flushDiskMapsForTests();

    map.delete('drop');
    // Another writer's file still carries it (and something new of
    // its own, which must still be folded in — adds stay allowed)
    writeFileSync(
      path,
      JSON.stringify([
        ['drop', 'their stale copy'],
        ['theirs', 'from the other process'],
      ])
    );
    map.set('trigger', 'a flush');
    flushDiskMapsForTests();

    const disk = diskEntries(path);
    expect(disk.has('drop')).toBe(false); // stayed dead
    expect(disk.get('theirs')).toBe('from the other process'); // add-never-destroy holds
    expect(disk.get('keep')).toBe('wanted');
  });

  test('clear empties the file too — a ledger reset that a restart cannot undo', () => {
    const name = 'forget-clear';
    const path = probe(name);
    const map = diskBackedMap<{ dollars: number; calls: number }>(name);
    map.set('2026-08-10', { dollars: 0.42, calls: 3 });
    flushDiskMapsForTests();
    expect(diskEntries(path).size).toBe(1);

    map.clear();
    flushDiskMapsForTests();

    expect(diskEntries(path).size).toBe(0);
    restart(name);
    expect(diskBackedMap(name).size).toBe(0);
  });

  test('an entry pruned for age is not resurrected by another writer’s stale file', () => {
    const name = 'forget-prune-fold';
    const path = probe(name);
    const map = diskBackedMap<{ value: string; at: number }>(name, { ttlMs: Ttl });
    map.set('live', { value: 'fresh', at: Date.now() });

    writeFileSync(
      path,
      JSON.stringify([
        ['ancient', { value: 'two hours old', at: Date.now() - 2 * Ttl }],
        ['fresh-foreign', { value: 'theirs, and current', at: Date.now() }],
      ])
    );
    map.set('trigger', { value: 'a flush', at: Date.now() });
    flushDiskMapsForTests();

    const disk = diskEntries(path);
    expect(disk.has('ancient')).toBe(false); // age is the one carve-out
    expect(disk.has('fresh-foreign')).toBe(true);
    expect(disk.has('live')).toBe(true);
  });
});

/**
 * The fold makes two WRITERS merge instead of clobber; this fence is
 * for the READER. Two dev servers share .ai-cache, each hydrates and
 * folds from the same path at moments of its own choosing, and
 * writeFileSync is not atomic — a reader landing mid-write parses a
 * torn file, hydrates empty, and the writer's entries leave the disk
 * for good the moment that reader flushes. rename() on one filesystem
 * is atomic: old file or new file, never half of either.
 */
describe('diskBackedMap atomic flush', () => {
  const name = 'test-atomic-cache';
  const dir = process.env.AI_CACHE_DIR as string;
  const path = `${dir}/${name}.json`;

  afterAll(() => {
    if (existsSync(path)) {
      rmSync(path);
    }
  });

  test('the flush lands by rename — the shared path is never written in place', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('fs') as {
      writeFileSync: (target: string, data: string) => void;
      readdirSync: (target: string) => string[];
    };
    const realWrite = fs.writeFileSync;
    const written: string[] = [];
    const spy = jest.spyOn(fs, 'writeFileSync').mockImplementation((target, data) => {
      written.push(String(target));
      return realWrite.call(fs, target as string, data as string);
    });
    try {
      const map = diskBackedMap<{ at: number }>(name);
      map.set('k', { at: Date.now() });
      flushDiskMapsForTests();
    } finally {
      spy.mockRestore();
    }

    // Every byte went to a scratch file; the shared path only ever
    // receives complete files, by rename
    expect(written).not.toContain(path);
    expect(written.some((target) => target.startsWith(`${path}.tmp-`))).toBe(true);
    expect(diskEntries(path).has('k')).toBe(true);
    // …and the scratch is gone: renamed, not abandoned
    const leftovers = fs.readdirSync(dir).filter((entry) => entry.startsWith(`${name}.json.tmp-`));
    expect(leftovers).toEqual([]);
  });
});
