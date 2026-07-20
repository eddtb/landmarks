import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

/**
 * The walk: the app's persistent user state. Anchor-first — stories
 * arrive via ＋Walk and the suggestion doors, never generated whole.
 * Persists until explicitly cleared. AsyncStorage is require-guarded:
 * clients built before it exists keep a session-only walk.
 */

export type WalkStop = {
  pageId: number;
  title: string;
  thumbnailUrl?: string;
  coordinates: Coordinates;
  /** e.g. "Wikipedia" — richer source badges arrive with the heritage layer. */
  source: string;
  hook?: string;
  /** Source text for the spoken telling; stops without it are named, not told. */
  extract?: string;
};

type Listener = () => void;

type Storage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

const storage: Storage | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-async-storage/async-storage').default as Storage;
  } catch {
    return null;
  }
})();

const StorageKey = 'venture.walk.v1';

let stops: WalkStop[] = [];
let hydrated = false;
const listeners = new Set<Listener>();

async function hydrate() {
  if (hydrated || !storage) {
    hydrated = true;
    return;
  }
  hydrated = true;
  try {
    const raw = await storage.getItem(StorageKey);
    if (raw) {
      stops = JSON.parse(raw) as WalkStop[];
      emit();
    }
  } catch {
    // A fresh walk beats a crashed one
  }
}

function persist() {
  storage?.setItem(StorageKey, JSON.stringify(stops)).catch(() => {});
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function getWalkStops(): WalkStop[] {
  return stops;
}

export function subscribeToWalk(listener: Listener): () => void {
  listeners.add(listener);
  void hydrate();
  return () => listeners.delete(listener);
}

export function addToWalk(stop: WalkStop) {
  if (stops.some((existing) => existing.pageId === stop.pageId)) {
    return;
  }
  stops = [...stops, stop];
  persist();
  emit();
}

export function removeFromWalk(pageId: number) {
  stops = stops.filter((stop) => stop.pageId !== pageId);
  persist();
  emit();
}

export function clearWalk() {
  stops = [];
  persist();
  emit();
}

export function isOnWalk(pageId: number): boolean {
  return stops.some((stop) => stop.pageId === pageId);
}

/** Pure and unit-tested: the reorder itself. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list;
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** ↑/↓ semantics: shift one slot, clamped at the ends. */
export function moveWalkStop(index: number, direction: -1 | 1) {
  const next = moveItem(stops, index, index + direction);
  if (next !== stops) {
    stops = next;
    persist();
    emit();
  }
}

export function walkStopFromStory(item: HistoryItem): WalkStop {
  return {
    pageId: item.pageId,
    title: item.title,
    thumbnailUrl: item.thumbnailUrl,
    coordinates: item.coordinates,
    source: item.source,
    hook: item.extract?.match(/^.*?\.(?=\s|$)/)?.[0],
    extract: item.extract,
  };
}
