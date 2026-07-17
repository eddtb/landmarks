import { diskBackedMap } from '@/server/ai-cache';

// Same guarded require the module itself uses — the app tsconfig has
// no node types, and this test only runs under node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  rmSync: (path: string) => void;
};

/**
 * The cache's whole job is surviving the process: entries written
 * before a dev-server restart must hydrate after it. Simulated here
 * by dropping the in-memory instance and re-creating from disk.
 */
describe('diskBackedMap', () => {
  const name = 'test-suite-cache';
  const path = `.ai-cache/${name}.json`;

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
