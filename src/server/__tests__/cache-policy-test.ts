/**
 * The fence around the CLASS of disk-backed caches, not one instance
 * of it.
 *
 * #246 was not "history-lists-v7 grew" — it was that fifteen call
 * sites could each grow, and nothing anywhere said they mustn't. So
 * these tests walk the inventory the module itself records
 * (diskMapPolicies) rather than naming one map: a sixteenth cache
 * added next month is in that inventory the moment its module is
 * imported, and it faces the same two questions as the other fifteen —
 * is it bounded, and does it forget?
 */

// Importing a module is what creates its caches, so this list IS the
// inventory under test. A new cache belongs here with its module.
import '@/app/api/history+api';
import '@/app/api/story+api';
import '@/server/ai-budget';
import '@/server/area';
import '@/server/article';
import '@/server/gemini';
import '@/server/geograph';
import '@/server/heritage';
import '@/server/plaque-subject';
import '@/server/quiz';
import '@/server/retold';
import '@/server/route';
import '@/server/telling';
import '@/server/wikidata';

import { DefaultMaxEntries, diskBackedMap, diskMapPolicies } from '@/server/ai-cache';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, mkdirSync, rmSync, writeFileSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  rmSync: (path: string) => void;
  writeFileSync: (path: string, data: string) => void;
};

const CacheDir = process.env.AI_CACHE_DIR as string;
const policies = [...diskMapPolicies().entries()];
const probeNames: string[] = [];

afterAll(async () => {
  // Let the last debounced write land before sweeping, so a probe
  // cannot recreate its file after teardown
  await new Promise((resolve) => setTimeout(resolve, 2600));
  for (const name of probeNames) {
    const path = `${CacheDir}/${name}.json`;
    if (existsSync(path)) {
      rmSync(path);
    }
  }
});

test('the inventory is not empty — these tests would otherwise assert nothing', () => {
  // The trap this file exists to avoid: a table-driven suite over an
  // empty table is a green suite that tested nothing at all.
  expect(policies.length).toBeGreaterThanOrEqual(15);
});

describe.each(policies)('%s cache policy', (name, policy) => {
  test('is bounded — no cache may grow without a ceiling', () => {
    expect(Number.isFinite(policy.maxEntries)).toBe(true);
    expect(policy.maxEntries).toBeGreaterThan(0);
    // A cap so large it is a cap in name only fails too. The biggest
    // real one is wikidata's 5000 verdicts at ~86 bytes apiece.
    expect(policy.maxEntries).toBeLessThanOrEqual(5000);
  });

  test('forgets what has expired, at hydrate, before anything is served', () => {
    if (policy.ttlMs === undefined) {
      // Undated vocabulary (class labels) and day-keyed ledgers have
      // no age to check — the cap alone bounds them, asserted above.
      return;
    }
    const probe = `policy-probe-${name}`;
    probeNames.push(probe);
    mkdirSync(CacheDir, { recursive: true });
    writeFileSync(
      `${CacheDir}/${probe}.json`,
      JSON.stringify([
        ['stale', { value: 'written before the TTL ran out', at: Date.now() - policy.ttlMs - 1 }],
        ['live', { value: 'still good', at: Date.now() }],
      ])
    );

    const map = diskBackedMap<{ value: string; at: number }>(probe, policy);

    expect(map.has('stale')).toBe(false); // never even reaches a caller
    expect(map.get('live')?.value).toBe('still good');
  });

  test('holds no more than its cap, whatever hydrates from disk', () => {
    const probe = `policy-cap-probe-${name}`;
    probeNames.push(probe);
    mkdirSync(CacheDir, { recursive: true });
    const overCap = policy.maxEntries + 5;
    writeFileSync(
      `${CacheDir}/${probe}.json`,
      JSON.stringify(
        Array.from({ length: overCap }, (_, index) => [
          `key-${index}`,
          { value: index, at: Date.now() - (overCap - index) },
        ])
      )
    );

    const map = diskBackedMap<{ value: number; at: number }>(probe, policy);

    expect(map.size).toBe(policy.maxEntries);
    expect(map.has('key-0')).toBe(false); // oldest-written left first
    expect(map.has(`key-${overCap - 1}`)).toBe(true); // newest stayed
  });
});

test('a cache that names no cap is still bounded — unbounded is unreachable', () => {
  const probe = 'policy-default-cap';
  probeNames.push(probe);
  const map = diskBackedMap<number>(probe);

  for (let index = 0; index < DefaultMaxEntries + 10; index++) {
    map.set(`k-${index}`, index);
  }

  expect(map.size).toBe(DefaultMaxEntries);
});
