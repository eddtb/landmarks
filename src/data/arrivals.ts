import { useSyncExternalStore } from 'react';

import { persistedMap } from '@/data/persisted-cache';
import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';
import { storyHook } from '@/utils/format';

/**
 * Arrivals: the app's one piece of work that happens while nobody is
 * looking at it. iOS monitors a set of regions for us and wakes the
 * app when the user crosses into one, whereupon it says — once —
 * "you're standing where this happened".
 *
 * Two constraints shape everything here.
 *
 * The first is iOS's hard ceiling of TWENTY monitored regions per
 * app. A city block can hold more history than that, so the armed set
 * is a CHOICE, re-made every time the feed moves: what the user saved
 * holds its slots first (an explicit choice outranks proximity), then
 * the nearest of what's around them fills the rest. Arming is a
 * whole-set replace, never an append — startGeofencingAsync takes the
 * list as the truth for its task.
 *
 * The second is that a geofence wake starts a COLD JS runtime. The
 * background task gets a region identifier and nothing else: no feed
 * in memory, no React tree, no hooks. So the armed table is written
 * to disk as it is armed, and the task reads it back to learn the
 * name of the place it just arrived at. That is why regions live in
 * this store rather than in a module variable — a module variable
 * would be empty in exactly the situation the feature exists for.
 *
 * The whole thing is off until asked for. Background location is not
 * something to switch on for someone (and App Review expects the
 * opt-in too) — see the invitation card in the feed.
 */

/** What the background task needs to name a place, with no network. */
export type ArrivalRegion = {
  pageId: number;
  title: string;
  coordinates: Coordinates;
  /** The one line that gives someone a reason to look up. */
  hook?: string;
};

type ArrivalState = {
  enabled: boolean;
  /** The armed set, by pageId — the cold task's only source of names. */
  regions: Record<string, ArrivalRegion>;
  /** pageId → when we last announced it, so a place says its piece once. */
  announced: Record<string, number>;
  /** The invitation was declined — offered once, not on every launch. */
  invitationDismissed?: boolean;
};

const EmptyState: ArrivalState = { enabled: false, regions: {}, announced: {} };

/**
 * iOS monitors at most 20 regions per app; Android allows 100. One
 * number governs both — the interesting engineering is in CHOOSING
 * twenty well, and a platform-dependent set would make the choice
 * untestable in one place.
 */
export const MaxArrivalRegions = 20;

/**
 * A radius small enough to mean "here" and large enough for a phone in
 * a pocket in a street of tall buildings. Below ~100m CoreLocation
 * starts missing crossings outright.
 */
export const ArrivalRadiusMeters = 120;

/** A place says its piece once a week at most, however often you pass. */
export const ReannounceAfterMs = 7 * 24 * 60 * 60 * 1000;

// Infinity TTL: a preference and its armed set never go stale on a
// clock — they change when the user moves or changes their mind.
const store = persistedMap<ArrivalState>('arrivals', Infinity);
const StateKey = 'state';

let state: ArrivalState | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Resolves once the last session's opt-in and armed set are readable. */
export const arrivalsHydrated: Promise<void> = store.hydrated.then(() => {
  if (state === null) {
    state = store.peek(StateKey)?.value ?? EmptyState;
    notify();
  }
});

function write(next: ArrivalState) {
  state = next;
  store.set(StateKey, next);
  notify();
}

/**
 * Force the debounced write through. The background task runs in a
 * runtime iOS may kill the moment it returns — persistedMap's 1s
 * debounce and its flush-on-backgrounding both assume a foreground
 * app that gets to keep living, and neither holds here. Without this,
 * an announcement's "already said" mark can be lost and the same
 * place greets the user again on the next crossing.
 */
export function flushArrivals(): Promise<void> {
  return store.flush();
}

export function arrivalsEnabled(): boolean {
  return state?.enabled ?? false;
}

/** The armed region for an identifier — the cold task's lookup. */
export function armedRegion(pageId: number): ArrivalRegion | undefined {
  return state?.regions[String(pageId)];
}

export function armedRegions(): ArrivalRegion[] {
  return Object.values(state?.regions ?? {});
}

/**
 * Has this place already had its say inside the re-announce window?
 * Checked in the background task, where being wrong means either a
 * duplicate notification or a missed one.
 */
export function recentlyAnnounced(pageId: number, now = Date.now()): boolean {
  const at = state?.announced[String(pageId)];
  return typeof at === 'number' && now - at < ReannounceAfterMs;
}

export function markAnnounced(pageId: number, now = Date.now()) {
  if (state === null) {
    return;
  }
  // Only the armed set is worth remembering: once a place can no
  // longer be arrived at, its mark is dead weight in a store that is
  // read on every cold background wake.
  const live = new Set(Object.keys(state.regions));
  const announced = Object.fromEntries(
    Object.entries({ ...state.announced, [String(pageId)]: now }).filter(([key]) =>
      live.has(key)
    )
  );
  write({ ...state, announced });
}

/** Remember the choice. Arming itself is the geofence module's job. */
export function setArrivalsEnabled(enabled: boolean) {
  if (state === null) {
    return;
  }
  // Off is a clearing, not a flag flip: leaving the armed set behind
  // would let a stale table name a place after the user opted out.
  // The dismissal survives it — someone who turns arrivals off has
  // answered the invitation more clearly than dismissing it ever did.
  write(
    enabled
      ? { ...state, enabled: true }
      : { ...EmptyState, invitationDismissed: true }
  );
}

/**
 * Whether to offer arrivals in the feed. Once only: not while they are
 * already on, and not after the offer has been turned down.
 */
export function shouldOfferArrivals(): boolean {
  return state !== null && !state.enabled && !state.invitationDismissed;
}

export function dismissArrivalInvitation() {
  if (state === null) {
    return;
  }
  write({ ...state, invitationDismissed: true });
}

export function useShouldOfferArrivals(): boolean {
  return useSyncExternalStore(subscribe, shouldOfferArrivals, shouldOfferArrivals);
}

/** Record what was just armed, so a cold wake can name it. */
export function setArmedRegions(regions: ArrivalRegion[]) {
  if (state === null) {
    return;
  }
  const next = Object.fromEntries(regions.map((region) => [String(region.pageId), region]));
  const live = new Set(Object.keys(next));
  const announced = Object.fromEntries(
    Object.entries(state.announced).filter(([key]) => live.has(key))
  );
  write({ ...state, regions: next, announced });
}

/**
 * Which twenty. Saved places go first — the user pointed at those, and
 * proximity should not be able to evict a choice — then the nearest of
 * whatever else is around, until the ceiling.
 *
 * Events and areas are excluded on the same ground the feed excludes
 * them: you cannot walk to a happening, and an area has no doorstep to
 * arrive at. A geofence around "Greenwich" would fire in the middle of
 * a bus journey and mean nothing.
 *
 * Pure, and exported for its own sake: this is the decision worth
 * testing, and it needs no location services to test.
 */
export function selectArrivalRegions(
  nearby: HistoryItem[],
  saved: HistoryItem[],
  limit = MaxArrivalRegions
): ArrivalRegion[] {
  const arrivable = (item: HistoryItem) => !item.event && !item.area;
  const chosen = new Map<number, HistoryItem>();

  for (const item of saved.filter(arrivable)) {
    if (chosen.size >= limit) {
      break;
    }
    chosen.set(item.pageId, item);
  }
  // The feed arrives sorted by distance, but it is not this function's
  // place to trust that — a caller passing the saved shelf as `nearby`
  // would get an arbitrary twenty.
  const byDistance = [...nearby.filter(arrivable)].sort(
    (a, b) => a.distanceMeters - b.distanceMeters
  );
  for (const item of byDistance) {
    if (chosen.size >= limit) {
      break;
    }
    if (!chosen.has(item.pageId)) {
      chosen.set(item.pageId, item);
    }
  }

  return [...chosen.values()].map((item) => ({
    pageId: item.pageId,
    title: item.subject ?? item.title,
    coordinates: item.coordinates,
    hook: storyHook(item.extract),
  }));
}

/**
 * Has the armed set actually changed? Walking mints a new feed every
 * hundred metres or so, and re-arming CoreLocation with an identical
 * set costs a background permission round-trip and resets region state
 * — which can drop a crossing the user is halfway through.
 */
export function sameArmedSet(a: ArrivalRegion[], b: ArrivalRegion[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const ids = new Set(a.map((region) => region.pageId));
  return b.every((region) => ids.has(region.pageId));
}

/** How far the user has moved from a coordinate, for re-arm decisions. */
export function movedBeyond(from: Coordinates, to: Coordinates, meters: number): boolean {
  return distanceMeters(from, to) > meters;
}

export function useArrivalsEnabled(): boolean {
  return useSyncExternalStore(subscribe, arrivalsEnabled, arrivalsEnabled);
}

/** Tests only: the store is module-level and must not leak between them. */
export function setArrivalsForTests(next: Partial<ArrivalState> | null) {
  state = next === null ? null : { ...EmptyState, ...next };
  notify();
}
