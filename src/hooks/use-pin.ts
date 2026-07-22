import { useSyncExternalStore } from 'react';

import { Coordinates } from '@/utils/geo';

/**
 * The manual pin — ONE for the whole app. Both tabs stay mounted and
 * each wraps its own LocationGate; per-gate useState gave each tab a
 * private pin, so Nearby could be exploring Alnwick while History
 * still showed Greenwich (sim-verified). A module-level store keeps
 * the primitive diet: a value, a listener set, useSyncExternalStore.
 *
 * `blind` records how the pin was dropped: no fix at the time (an
 * emergency hatch that self-releases when GPS arrives — the gate
 * derives that) or deliberately with GPS live (holds until "Back to
 * near me"). Deliberately in-memory only: location-first says never
 * freeze the user's position, so a pin must not outlive the process.
 *
 * `label` is the place name the user actually TYPED to drop the pin —
 * the area-name cascade's first candidate. The searcher knows what
 * they meant better than the reverse geocoder, which answers with the
 * ward ("Dorking North" for Dorking) and strands the gazetteer.
 */
export type Pin = { center: Coordinates; blind: boolean; label?: string };

let pin: Pin | null = null;
const listeners = new Set<() => void>();

export function setPin(next: Pin | null) {
  pin = next;
  for (const listener of listeners) {
    listener();
  }
}

export function clearPin() {
  setPin(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return pin;
}

/** Every subscriber sees the same pin, and every drop or release. */
export function usePin(): Pin | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
