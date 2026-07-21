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
 * swallowed: a failed persist never breaks the app.
 */
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
// two instances of the same store would clobber each other's debounce
const registry = new Map<string, unknown>();

export function persistedMap<V>(name: string, ttlMs: number): PersistedMap<V> {
  const existing = registry.get(name);
  if (existing) {
    return existing as PersistedMap<V>;
  }

  const storageKey = `cache-${name}-v1`;
  const map = new Map<string, PersistedEntry<V>>();

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
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  let writing: Promise<void> = Promise.resolve();

  async function writeBack(): Promise<void> {
    try {
      // Merge-on-write: ai-cache's lesson. A whole-map dump is
      // last-writer-wins, and two writers sharing one store were
      // watched erasing each other's entries. Fold in any stored
      // entries this instance never saw before flushing: writers may
      // only add, never destroy. (Folding uses the raw inner map, so
      // merging never re-arms the debounce.)
      for (const [key, entry] of await readStorage()) {
        if (!map.has(key)) {
          map.set(key, entry);
        }
      }
      await AsyncStorage.setItem(storageKey, JSON.stringify([...map.entries()]));
    } catch {
      // A failed persist never breaks the app — next set retries
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

  registry.set(name, api);
  return api;
}

/** Test seam: drop the live instance so the next call re-hydrates —
 * the "simulated process restart" from ai-cache-test's technique. */
export function dropPersistedMapForTests(name: string) {
  registry.delete(name);
}
