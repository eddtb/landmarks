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
 * write back (debounced) on set, delete and clear. On runtimes
 * without a filesystem (production edge workers), this degrades to
 * exactly the old in-memory behaviour.
 *
 * Bounded and forgetful, the client sibling's lesson brought back
 * (src/data/persisted-cache.ts): a map created with `ttlMs` drops
 * entries past their TTL on hydrate and before every serialise, and
 * one created with `maxEntries` evicts oldest-written first. Without
 * them these maps only ever grew — measured on this repo's own
 * .ai-cache before the fix, `history-lists-v7` held 13 entries at
 * 1.24MB and ALL THIRTEEN were past their one-hour TTL, and every
 * debounced flush read, parsed, merged, re-serialised and rewrote all
 * 1.24MB of it. The TTL is what shrinks the flush; the cap is the
 * backstop for a store whose TTL is long.
 *
 * The TTL here governs PRUNING only, never what `get` returns —
 * deliberately. Two call sites (retold, quiz) pick their TTL from the
 * value itself (30 days for a telling, 7 for a "nothing to tell here"
 * verdict), so a single map-level TTL cannot express what they check;
 * they pass the LONGER one, which is safe because pruning at the
 * longer TTL can never drop an entry a caller would still have
 * served. The ~20 `Date.now() - at < Ttl` idioms therefore stay at
 * the call sites, where the value-shaped ones can live beside the
 * plain ones.
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

/**
 * Does a floated promise survive the response? On a long-lived Node
 * process, yes. On the production edge worker the isolate freezes the
 * moment the response returns and kills in-flight work (#232).
 *
 * `fs` looked like the honest tell and it is NOT: the server bundle
 * resolves a filesystem shim on the edge too, so this read `true`
 * everywhere and every edge-only branch behind it was dead code in
 * production — measured, not guessed, by a cold compose still
 * answering `dressing: true` from the deployed worker. Ask the
 * runtime who it is instead: Cloudflare Workers identifies itself,
 * and a missing filesystem still counts as the second signal.
 */
const onEdgeWorker =
  (typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers') || fs === null;

export const backgroundWorkSurvives = !onEdgeWorker;

// Tests point this elsewhere — they must never poison the real dev
// ledgers (a $5.13 test fixture once tripped the live breaker)
const CacheDir = process.env.AI_CACHE_DIR ?? '.ai-cache';

const globalCache = globalThis as {
  aiDiskMaps?: Map<string, Map<string, unknown>>;
  aiDiskPolicies?: Map<string, DiskMapPolicy>;
  aiDiskFlushers?: Map<string, () => void>;
};

const WriteDelayMs = 2000;

export type DiskMapOptions = {
  /**
   * Entries older than this leave on hydrate and before every write.
   * Read from the value's own `at` field, which every dated cache in
   * this codebase already carries; a value without one has no age and
   * is never pruned (the class-label vocabulary, the spend ledgers).
   */
  ttlMs?: number;
  /** Hard ceiling. Oldest-written entries leave first. */
  maxEntries?: number;
};

/**
 * The cap a call site gets when it names none. Unbounded is not
 * reachable from this module — fifteen call sites were, and the one
 * that mattered grew to 1.24MB of entries that were ALL expired. A
 * sixteenth added next month may forget its cap; it may not have
 * none. Generous enough that no store here notices, small enough that
 * forgetting cannot cost a megabyte.
 */
export const DefaultMaxEntries = 1000;

/** What a named cache was actually created with — the inventory the
 * class-level tests walk, rather than trusting fifteen call sites. */
export type DiskMapPolicy = { ttlMs?: number; maxEntries: number };

/** Every disk-backed cache this process has created, and its policy. */
export function diskMapPolicies(): Map<string, DiskMapPolicy> {
  return new Map(globalCache.aiDiskPolicies ?? []);
}

/**
 * Test seam, the sibling of persistedMap's `flush`: enact every
 * pending debounced write now, instead of waiting out the two-second
 * debounce once per assertion. The write it performs is the real one.
 */
export function flushDiskMapsForTests() {
  const timers = (globalThis as { aiCacheTimers?: Map<string, ReturnType<typeof setTimeout>> })
    .aiCacheTimers;
  for (const [name, flush] of globalCache.aiDiskFlushers ?? []) {
    const pending = timers?.get(name);
    if (pending) {
      clearTimeout(pending);
      timers!.delete(name);
      flush();
    }
  }
}

/** When a cached value says it was written, if it says at all. */
function writtenAt(value: unknown): number | undefined {
  const at = (value as { at?: unknown } | null | undefined)?.at;
  return typeof at === 'number' ? at : undefined;
}

/** One debounce per named map, shared across every kind of write. */
function writeSoon(name: string, flush: () => void) {
  if (!fs) {
    return;
  }
  const timers = ((globalThis as { aiCacheTimers?: Map<string, ReturnType<typeof setTimeout>> })
    .aiCacheTimers ??= new Map());
  const pending = timers.get(name);
  if (pending) {
    clearTimeout(pending);
  }
  const timer = setTimeout(flush, WriteDelayMs);
  // Never hold the process open for a cache write (node-only API)
  (timer as { unref?: () => void }).unref?.();
  timers.set(name, timer);
}

/**
 * A Map that outlives the process, bounded by age and by size.
 * Drop-in for the globalThis caches.
 */
export function diskBackedMap<V>(name: string, options: DiskMapOptions = {}): Map<string, V> {
  globalCache.aiDiskMaps ??= new Map();
  const existing = globalCache.aiDiskMaps.get(name);
  if (existing) {
    // Options belong to whoever created the map first — the same rule
    // the client's registry keeps, so a bare diskBackedMap('x') in a
    // test can never quietly unbound a live store.
    return existing as Map<string, V>;
  }

  const { ttlMs } = options;
  const maxEntries = options.maxEntries ?? DefaultMaxEntries;
  (globalCache.aiDiskPolicies ??= new Map()).set(name, { ttlMs, maxEntries });
  const map = new Map<string, V>();
  // The prototype methods, reached before the patches below: pruning,
  // eviction and the merge fold must never re-arm the debounce.
  const rawSet = Map.prototype.set.bind(map);
  const rawDelete = Map.prototype.delete.bind(map);
  const rawClear = Map.prototype.clear.bind(map);

  /** Past its TTL is past its usefulness — nothing here serves stale. */
  function pruneExpired() {
    if (ttlMs === undefined) {
      return;
    }
    const cutoff = Date.now() - ttlMs;
    for (const [key, value] of map) {
      const at = writtenAt(value);
      if (at !== undefined && at < cutoff) {
        rawDelete(key);
      }
    }
  }

  /** Oldest-written entries leave first once the map is over its cap.
   * (persisted-cache's evictOverCap, brought back to the server.) */
  function evictOverCap() {
    while (map.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, value] of map) {
        // Undated values have no age — they leave in insertion order,
        // which for the day-keyed ledgers IS chronological order
        const at = writtenAt(value) ?? 0;
        if (at < oldestAt) {
          oldestAt = at;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) {
        return;
      }
      rawDelete(oldestKey);
    }
  }

  if (fs) {
    try {
      const path = `${CacheDir}/${name}.json`;
      if (fs.existsSync(path)) {
        for (const [key, value] of JSON.parse(fs.readFileSync(path, 'utf8')) as [string, V][]) {
          rawSet(key, value);
        }
      }
    } catch (error) {
      console.warn(`AI cache read failed (${name}):`, error);
    }
  }
  // A store written before a TTL or a newly-tightened cap arrives over
  // both — trim on arrival rather than carry it for another process life
  pruneExpired();
  evictOverCap();

  // What this process has forgotten, until the write that enacts it.
  // Without these the merge fold below (which exists so concurrent
  // writers may only add, never destroy) folds a deleted entry
  // straight back off disk, and the delete never happened.
  const forgotten = new Set<string>();
  let forgotEverything = false;

  const flush = () => {
    try {
      fs!.mkdirSync(CacheDir, { recursive: true });
      const path = `${CacheDir}/${name}.json`;
      // Merge-on-write: a whole-map dump is last-writer-wins, and two
      // processes sharing .ai-cache were watched erasing each other's
      // entries — including retellings that cost real quota. Fold in
      // any disk entries this process never saw before flushing:
      // writers may only add, never destroy.
      //
      // Two carve-outs, both about forgetting. Age: an entry past the
      // TTL is not folded back, so one process's prune cannot be undone
      // by another's stale file (the client's rule, same reasoning).
      // Intent: a key this process deleted, or a clear() that meant all
      // of them, is not folded back either — a delete that survives
      // only until the next hydrate is not a delete.
      //
      // Unlike the client this folds on EVERY flush, not just the
      // first: React Native runs one app process, but two dev servers
      // sharing .ai-cache is ordinary here, and either may write at
      // any point in the other's life.
      try {
        const cutoff = ttlMs === undefined ? -Infinity : Date.now() - ttlMs;
        if (!forgotEverything && fs!.existsSync(path)) {
          for (const [key, value] of JSON.parse(fs!.readFileSync(path, 'utf8')) as [
            string,
            V,
          ][]) {
            if (map.has(key) || forgotten.has(key)) {
              continue;
            }
            if ((writtenAt(value) ?? Infinity) < cutoff) {
              continue;
            }
            rawSet(key, value);
          }
        }
      } catch {
        // Unreadable disk state never blocks the write of good state
      }
      pruneExpired();
      evictOverCap();
      fs!.writeFileSync(path, JSON.stringify([...map.entries()]));
      // Enacted: disk no longer holds them, so a later fold can only
      // find them if another process wrote them back — which is an
      // add, and adds are allowed
      forgotten.clear();
      forgotEverything = false;
    } catch (error) {
      console.warn(`AI cache write failed (${name}):`, error);
    }
  };

  (globalCache.aiDiskFlushers ??= new Map()).set(name, flush);

  map.set = (key: string, value: V) => {
    forgotten.delete(key);
    rawSet(key, value);
    evictOverCap();
    writeSoon(name, flush);
    return map;
  };

  map.delete = (key: string) => {
    const had = rawDelete(key);
    if (had) {
      forgotten.add(key);
      writeSoon(name, flush);
    }
    return had;
  };

  map.clear = () => {
    rawClear();
    forgotten.clear();
    forgotEverything = true;
    writeSoon(name, flush);
  };

  globalCache.aiDiskMaps.set(name, map);
  return map;
}
