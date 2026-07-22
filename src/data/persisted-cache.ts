/**
 * AsyncStorage-backed Maps for the client's caches — the on-device
 * sibling of the server's diskBackedMap (src/server/ai-cache.ts).
 * The in-memory caches die with the process, and on a phone the
 * process dies constantly (force-quit mid-walk, OS reaping) — right
 * when the user is in this app's natural habitat: a park or the foot
 * tunnel, with no signal. Persisting the same buckets UNDER THE SAME
 * KEYS lets the app reopen instantly and degrade gracefully offline.
 *
 * Location-first still governs: this module never invents keys — it
 * persists whatever bucket key the caller derived from the user's
 * LIVE position, so movement busts persisted entries exactly as it
 * busts in-memory ones.
 *
 * Entries carry their written-at timestamp. `get` serves only entries
 * younger than the map's TTL; `peek` returns anything persisted (even
 * expired) so callers can show it as a placeholder while a fresh
 * fetch runs, or as a last resort when the network is gone — never as
 * a silent substitute for re-asking. Only real data is ever written:
 * failures are the caller's to handle, not this map's to remember.
 *
 * AsyncStorage is async, so hydration is too: `hydrated` resolves
 * once persisted entries are folded in — await it before first-paint
 * decisions. Writes are debounced and fire-and-forget with errors
 * swallowed: a failed persist never breaks the app (though a dead
 * store warns once per session so dev can see it). Backgrounding
 * flushes the debounce (that's how a walking app's process normally
 * dies), and every write-back prunes entries older than 2× the TTL:
 * recently-expired stays peekable offline material.
 *
 * Bounded: a map created with `maxEntries` evicts its oldest-written
 * entries beyond the cap (on set, hydration, and write-back). The TTL
 * prune bounds age; the cap bounds size — a walking app mints a new
 * location bucket every few hundred metres, and Android's AsyncStorage
 * ships with a ~6MB ceiling that an uncapped feed store was measured
 * blowing through after ~50 buckets, killing persistence silently.
 *
 * Write-back cost — the fold-once invariant: merge-on-write (re-read
 * storage, fold in entries we haven't seen) exists so writers may only
 * add, never destroy. But each named map is a process singleton (the
 * registry), and React Native runs ONE app process — a "second writer"
 * only exists across process lifetimes, and its writes can only be in
 * storage before ours started or after ours died. So foreign entries
 * can only surface at the hydration boundary: we fold on the FIRST
 * write-back after creation (catching anything that landed between the
 * hydration read and our first write), then skip the whole-store
 * getItem+parse for the rest of the process's life. Measured before
 * this: ~34ms desktop / ~100-170ms phone JS-thread per debounced
 * write-back at 100 buckets, paid every ~7.5s while walking.
 */
import { AppState } from 'react-native';

import AsyncStorage from '@react-native-async-storage/async-storage';

export type PersistedEntry<V> = { value: V; at: number };

export type PersistedMap<V> = {
  /** Resolves once persisted entries have been folded in. */
  hydrated: Promise<void>;
  /** A live entry (younger than the TTL), or undefined. */
  get(key: string): V | undefined;
  /** Any entry, even expired — placeholder/offline material only. */
  peek(key: string): PersistedEntry<V> | undefined;
  set(key: string, value: V): void;
  /** All live (within-TTL) values. */
  values(): V[];
  /** Force any pending write-back now. Test seam / teardown aid. */
  flush(): Promise<void>;
};

const WriteDelayMs = 1000;

// One live instance per name, like ai-cache's globalThis registry —
// two instances of the same store would clobber each other's debounce.
// Options (ttl, cap) are fixed by whoever creates the map first.
const registry = new Map<string, unknown>();

export function persistedMap<V>(
  name: string,
  ttlMs: number,
  options?: { maxEntries?: number }
): PersistedMap<V> {
  const existing = registry.get(name);
  if (existing) {
    return existing as PersistedMap<V>;
  }

  const storageKey = `cache-${name}-v1`;
  const maxEntries = options?.maxEntries ?? Infinity;
  const map = new Map<string, PersistedEntry<V>>();

  /** Oldest-written entries leave first once the map is over its cap. */
  function evictOverCap() {
    while (map.size > maxEntries) {
      let oldestKey: string | undefined;
      let oldestAt = Infinity;
      for (const [key, entry] of map) {
        if (entry.at < oldestAt) {
          oldestAt = entry.at;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) {
        return;
      }
      map.delete(oldestKey);
    }
  }

  /** Corrupted or missing storage reads as empty — never a throw. */
  async function readStorage(): Promise<[string, PersistedEntry<V>][]> {
    try {
      const raw = await AsyncStorage.getItem(storageKey);
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return (parsed as [string, PersistedEntry<V>][]).filter(
        (pair) =>
          Array.isArray(pair) &&
          typeof pair[0] === 'string' &&
          typeof pair[1]?.at === 'number' &&
          pair[1].value !== undefined
      );
    } catch {
      return [];
    }
  }

  // Hydrate once. Anything set in this session is newer than anything
  // persisted — persisted entries only fill keys we haven't written.
  const hydrated = readStorage().then((entries) => {
    for (const [key, entry] of entries) {
      if (!map.has(key)) {
        map.set(key, entry);
      }
    }
    // A legacy store may exceed a newly-tightened cap — trim on arrival
    evictOverCap();
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();
  // Storage may hold entries this process hasn't seen only until the
  // first write-back's fold — see the fold-once invariant up top.
  let foldedForeignWrites = false;
  let warnedDeadStore = false;

  async function writeBack(): Promise<void> {
    try {
      // Merge-on-write: ai-cache's lesson. A whole-map dump is
      // last-writer-wins, and two writers sharing one store were
      // watched erasing each other's entries. Fold in any stored
      // entries this instance never saw before flushing: writers may
      // only add, never destroy. Per the fold-once invariant (module
      // header), foreign entries can only exist at the hydration
      // boundary — one fold on the first write-back also covers a
      // write-back that fires before hydration has resolved, and
      // every later write-back skips the whole-store getItem+parse.
      // (Folding uses the raw inner map, so it never re-arms the
      // debounce.)
      //
      // "Never destroy" has one carve-out: age. Entries older than
      // the grace window (2× the TTL) are pruned — from the fold, so
      // a second writer can't resurrect what the first pruned, and
      // from this map before serializing. Between TTL and 2×TTL an
      // entry is dead for `get` but lives on as peek material.
      const cutoff = Date.now() - 2 * ttlMs;
      if (!foldedForeignWrites) {
        for (const [key, entry] of await readStorage()) {
          if (!map.has(key) && entry.at >= cutoff) {
            map.set(key, entry);
          }
        }
        foldedForeignWrites = true;
      }
      for (const [key, entry] of map) {
        if (entry.at < cutoff) {
          map.delete(key);
        }
      }
      evictOverCap();
      await AsyncStorage.setItem(storageKey, JSON.stringify([...map.entries()]));
    } catch (error) {
      // A failed persist never breaks the app — next set retries. But
      // a persistently-failing store (Android's 6MB ceiling, disk
      // full) means offline survival is quietly gone: say so once.
      if (!warnedDeadStore) {
        warnedDeadStore = true;
        console.warn(`[persisted-cache] write-back failed for '${name}' — persistence may be dead this session`, error);
      }
    }
  }

  function scheduleWrite() {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      writing = writeBack();
    }, WriteDelayMs);
    // Never hold a process open for a cache write — node-only API,
    // a no-op on React Native where timers are plain numbers
    (timer as { unref?: () => void }).unref?.();
  }

  const api: PersistedMap<V> = {
    hydrated,
    get(key) {
      const entry = map.get(key);
      if (!entry || Date.now() - entry.at > ttlMs) {
        return undefined;
      }
      return entry.value;
    },
    peek(key) {
      return map.get(key);
    },
    set(key, value) {
      map.set(key, { value, at: Date.now() });
      evictOverCap();
      scheduleWrite();
    },
    values() {
      const now = Date.now();
      return [...map.values()]
        .filter((entry) => now - entry.at <= ttlMs)
        .map((entry) => entry.value);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        writing = writeBack();
      }
      await writing;
    },
  };

  // Backgrounding is how a walking app's process normally dies — the
  // OS reaps it from the background sooner or later. Flush the
  // debounced write on the way out rather than lose the last second
  // of sets to a force-quit. (One listener per named map, held for
  // the process's life alongside the registry entry.)
  AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void api.flush();
    }
  });

  registry.set(name, api);
  return api;
}

/** Test seam: drop the live instance so the next call re-hydrates —
 * the "simulated process restart" from ai-cache-test's technique. */
export function dropPersistedMapForTests(name: string) {
  registry.delete(name);
}
