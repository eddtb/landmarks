/**
 * Disk-backed caches for billed AI results. The globalThis caches
 * survive requests but die with the process — and in development the
 * process dies constantly (every dev-server restart), so every venue
 * ever opened re-fired its web-searching research call on the next
 * visit. That pattern quietly burned through the API budget: the
 * cache hit rate ACROSS restarts was the whole cost model, and it
 * was zero.
 *
 * Entries hydrate from .ai-cache/<name>.json at first access and
 * write back (debounced) on set. On runtimes without a filesystem
 * (production edge workers), this degrades to exactly the old
 * in-memory behaviour.
 */

type FsModule = {
  readFileSync: (path: string, encoding: 'utf8') => string;
  writeFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string, options: { recursive: boolean }) => void;
  existsSync: (path: string) => boolean;
};

let fs: FsModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  fs = require('fs') as FsModule;
} catch {
  fs = null;
}

const CacheDir = '.ai-cache';

const globalCache = globalThis as { aiDiskMaps?: Map<string, Map<string, unknown>> };

function writeSoon(name: string, map: Map<string, unknown>) {
  if (!fs) {
    return;
  }
  const timers = ((globalThis as { aiCacheTimers?: Map<string, ReturnType<typeof setTimeout>> })
    .aiCacheTimers ??= new Map());
  const pending = timers.get(name);
  if (pending) {
    clearTimeout(pending);
  }
  const timer = setTimeout(() => {
    try {
      fs!.mkdirSync(CacheDir, { recursive: true });
      fs!.writeFileSync(`${CacheDir}/${name}.json`, JSON.stringify([...map.entries()]));
    } catch (error) {
      console.warn(`AI cache write failed (${name}):`, error);
    }
  }, 2000);
  // Never hold the process open for a cache write (node-only API)
  (timer as { unref?: () => void }).unref?.();
  timers.set(name, timer);
}

/** A Map that outlives the process. Drop-in for the globalThis caches. */
export function diskBackedMap<V>(name: string): Map<string, V> {
  globalCache.aiDiskMaps ??= new Map();
  const existing = globalCache.aiDiskMaps.get(name);
  if (existing) {
    return existing as Map<string, V>;
  }

  const map = new Map<string, V>();
  if (fs) {
    try {
      const path = `${CacheDir}/${name}.json`;
      if (fs.existsSync(path)) {
        for (const [key, value] of JSON.parse(fs.readFileSync(path, 'utf8')) as [string, V][]) {
          map.set(key, value);
        }
      }
    } catch (error) {
      console.warn(`AI cache read failed (${name}):`, error);
    }
  }

  const rawSet = map.set.bind(map);
  map.set = (key: string, value: V) => {
    const result = rawSet(key, value);
    writeSoon(name, map);
    return result;
  };

  globalCache.aiDiskMaps.set(name, map);
  return map;
}
