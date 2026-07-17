import { Place } from '@/types/place';
import { Coordinates } from '@/utils/geo';

/**
 * The plan: the app's first persistent user state. Anchor-first —
 * items arrive via ＋Plan and the suggestion rail, never generated
 * whole. Persists until explicitly cleared. AsyncStorage is a native
 * module, so it's require-guarded: clients built before it exists
 * keep a session-only plan and upgrade to persistence with the next
 * dev build.
 */

export type PlanItem = {
  id: string;
  kind: 'place' | 'story';
  name: string;
  photoUrl?: string;
  primaryLabel?: string;
  coordinates: Coordinates;
  rating?: number;
  facts: string[];
  /** Minutes this stop holds you — drives the computed timeline. */
  dwellMinutes: number;
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

const StorageKey = 'venture.plan.v1';

let items: PlanItem[] = [];
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
      items = JSON.parse(raw) as PlanItem[];
      emit();
    }
  } catch {
    // A fresh plan beats a crashed one
  }
}

function persist() {
  storage?.setItem(StorageKey, JSON.stringify(items)).catch(() => {});
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

export function getPlanItems(): PlanItem[] {
  return items;
}

export function subscribeToPlan(listener: Listener): () => void {
  listeners.add(listener);
  void hydrate();
  return () => listeners.delete(listener);
}

export function addToPlan(item: PlanItem) {
  if (items.some((existing) => existing.id === item.id)) {
    return;
  }
  items = [...items, item];
  persist();
  emit();
}

export function removeFromPlan(id: string) {
  items = items.filter((item) => item.id !== id);
  persist();
  emit();
}

export function reorderPlan(next: PlanItem[]) {
  items = next;
  persist();
  emit();
}

export function clearPlan() {
  items = [];
  persist();
  emit();
}

export function isPlanned(id: string): boolean {
  return items.some((item) => item.id === id);
}

/** Dwell by what the place is — the solver's table, client-side. */
export function dwellMinutesFor(primaryLabel: string | undefined, kind: 'place' | 'story'): number {
  if (kind === 'story') return 15;
  const label = primaryLabel ?? '';
  if (/Coffee|Cafe|Bakery|Dessert|Ice Cream/.test(label)) return 40;
  if (/Restaurant|Steak|Grill/.test(label)) return 90;
  if (/Pub|Bar/.test(label)) return 70;
  if (/Bowling|Karaoke|Arcade|Amusement|Comedy|Cinema|Movie/.test(label)) return 75;
  return 45;
}

export function planItemFromPlace(place: Place): PlanItem {
  return {
    id: place.id,
    kind: 'place',
    name: place.name,
    photoUrl: place.photoUrl,
    primaryLabel: place.primaryLabel,
    coordinates: place.coordinates,
    rating: place.rating,
    facts: [
      place.primaryLabel,
      place.rating ? `★ ${place.rating.toFixed(1)}` : undefined,
      place.priceLevel,
    ].filter((fact): fact is string => !!fact),
    dwellMinutes: dwellMinutesFor(place.primaryLabel, 'place'),
  };
}
