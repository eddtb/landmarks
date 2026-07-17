import { HistoryItem } from '@/types/history';
import { PlaceWithDistance } from '@/types/place';
import { PlanAlternate, PlanCompany, PlanDuration, PlanLeg, PlanStop, SlotKind } from '@/types/plan';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * The Plan engine's solver half: Claude annotates, THIS code solves.
 * Slots come from templates (duration × company × clock), candidates
 * from the cached category lists, and every constraint — open through
 * the window, walkable from the previous stop — is enforced here, in
 * code, where it can't be hallucinated. Pure and unit-testable; the
 * orchestration (routes, details, weather, annotation) lives in the
 * API route.
 */

const WalkingPaceMetersPerSecond = 1.33;

/** How long each kind of stop holds you, in minutes. */
const DwellMinutes: Record<SlotKind, number> = {
  coffee: 40,
  landmark: 45,
  activity: 75,
  meal: 90,
  drink: 70,
};

type Slot = { kind: SlotKind };

/**
 * The occasion grid's server half: duration picks the skeleton, the
 * clock adapts it (no pubs-first at 9am), company reshapes it
 * (family swaps the closing drink for something sweet or playful).
 */
export function slotTemplate(duration: PlanDuration, company: PlanCompany, start: Date): Slot[] {
  const hour = start.getHours();
  const closer: SlotKind = company === 'family' ? 'activity' : 'drink';
  // Company reshapes the skeleton, not just the venue ranking: a
  // friends' evening does something before the pub; a solo evening
  // is the unhurried walk, not the ticketed pair activity
  const eveningOpener: SlotKind = company === 'friends' ? 'activity' : 'landmark';

  if (duration === 'hour') {
    if (hour < 11) return [{ kind: 'coffee' }];
    if (hour < 17) return [{ kind: 'landmark' }];
    return [{ kind: company === 'solo' ? 'landmark' : closer }];
  }
  if (duration === 'evening') {
    return [{ kind: eveningOpener }, { kind: 'meal' }, { kind: closer }];
  }
  if (duration === 'halfday') {
    const opener: Slot[] =
      hour < 12 ? [{ kind: 'coffee' }, { kind: 'landmark' }] : [{ kind: 'landmark' }, { kind: 'activity' }];
    return [...opener, { kind: 'meal' }, { kind: closer }];
  }
  return [
    { kind: 'coffee' },
    { kind: 'landmark' },
    { kind: 'meal' },
    { kind: 'activity' },
    { kind: 'landmark' },
    { kind: 'meal' },
    { kind: closer },
  ];
}

const CoffeeLabels = new Set(['Coffee Shop', 'Cafe', 'Bakery']);
/** Rain moves the landmark slot indoors — parks stop scoring. */
const OutdoorLabels = new Set(['Park', 'Garden', 'Botanical Garden', 'Dog Park', 'Skatepark']);
const SweetLabels = new Set(['Dessert Shop', 'Ice Cream Shop', 'Bakery']);

export type CandidatePools = {
  landmark: PlaceWithDistance[];
  food: PlaceWithDistance[];
  drink: PlaceWithDistance[];
  activity: PlaceWithDistance[];
};

function poolFor(kind: SlotKind, company: PlanCompany, pools: CandidatePools): PlaceWithDistance[] {
  if (kind === 'coffee') {
    return [...pools.food, ...pools.drink].filter((p) => CoffeeLabels.has(p.primaryLabel ?? ''));
  }
  if (kind === 'landmark') {
    return pools.landmark;
  }
  if (kind === 'activity') {
    return pools.activity;
  }
  if (kind === 'meal') {
    return pools.food.filter((p) => !CoffeeLabels.has(p.primaryLabel ?? ''));
  }
  // drink
  if (company === 'family') {
    return pools.food.filter((p) => SweetLabels.has(p.primaryLabel ?? ''));
  }
  return pools.drink.filter((p) => p.primaryLabel !== 'Coffee Shop');
}

/**
 * Hard window constraint: a stop must plausibly hold its slot. Known
 * hours must cover arrival + most of the dwell; unknown hours pass
 * for landmarks (parks and monuments rarely report any) and fail for
 * anywhere with a till.
 */
export function openThroughWindow(place: PlaceWithDistance, kind: SlotKind, arrive: Date, depart: Date): boolean {
  if (place.openNow === false && !place.nextOpenTime) {
    return false;
  }
  if (place.openNow === false && place.nextOpenTime) {
    if (new Date(place.nextOpenTime) > arrive) {
      return false;
    }
  }
  if (place.nextCloseTime) {
    const close = new Date(place.nextCloseTime);
    const mustStayOpenUntil = new Date(arrive.getTime() + (depart.getTime() - arrive.getTime()) * 0.7);
    if (close < mustStayOpenUntil) {
      return false;
    }
  }
  if (place.openNow === undefined && kind !== 'landmark') {
    return false;
  }
  return true;
}

/**
 * Occasion affinity: company changes what KIND of place fits a slot,
 * not just which ranks best. Solo is not a smaller date — it's the
 * park walk you've never taken, not the ticketed pair activity.
 */
const Affinity: Partial<Record<PlanCompany, Partial<Record<SlotKind, Record<string, number>>>>> = {
  solo: {
    landmark: { Park: 2.5, Garden: 2.5, 'Botanical Garden': 2.5, 'Historical Landmark': 1 },
    drink: { Pub: 0.8 },
  },
  date: {
    landmark: { Park: 1.2, 'Historical Landmark': 1 },
    drink: { 'Wine Bar': 2, 'Cocktail Bar': 2, Bar: 0.8 },
  },
  friends: {
    activity: { 'Bowling Alley': 1.5, Karaoke: 1.5, 'Amusement Center': 1.2, 'Video Arcade': 1.2, 'Comedy Club': 1.5 },
    drink: { Pub: 1.2, Bar: 0.8 },
  },
  family: {
    landmark: { Park: 1.5, Museum: 1.5 },
    activity: { 'Comedy Club': -3 },
  },
};

function score(
  place: PlaceWithDistance,
  kind: SlotKind,
  company: PlanCompany,
  from: Coordinates,
  rainy: boolean
): number {
  // Review counts saturate at 1000: past that, more tourists don't
  // mean better — without the cap every plan converged on the same
  // mega-venues regardless of occasion
  const quality = place.rating * Math.log10(Math.min(place.ratingCount ?? 0, 1000) + 2);
  const walkMinutes = distanceMeters(from, place.coordinates) / WalkingPaceMetersPerSecond / 60;
  const distancePenalty = Math.max(0, walkMinutes - 5) * 0.35;
  const prominenceBonus = place.prominenceRank !== undefined ? 0.3 : 0;
  const rainPenalty = rainy && OutdoorLabels.has(place.primaryLabel ?? '') ? 4 : 0;
  const affinityBonus = Affinity[company]?.[kind]?.[place.primaryLabel ?? ''] ?? 0;
  const datePriceBonus =
    company === 'date' && kind === 'meal' && (place.priceLevel === '££' || place.priceLevel === '£££')
      ? 0.4
      : 0;
  return quality + prominenceBonus + affinityBonus + datePriceBonus - distancePenalty - rainPenalty;
}

function estimatedLegSeconds(from: Coordinates, to: Coordinates): number {
  return Math.round(distanceMeters(from, to) / WalkingPaceMetersPerSecond);
}

export function shortTime(date: Date): string {
  const hours24 = date.getHours();
  const minutes = date.getMinutes();
  const suffix = hours24 >= 12 ? 'pm' : 'am';
  const hours = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return minutes === 0 ? `${hours}${suffix}` : `${hours}:${String(minutes).padStart(2, '0')}${suffix}`;
}

function factsFor(place: PlaceWithDistance): string[] {
  const facts: string[] = [];
  if (place.ratingCount) {
    facts.push(`★ ${place.rating.toFixed(1)}`);
  }
  if (place.priceLevel) {
    facts.push(place.priceLevel);
  }
  if (place.nextCloseTime) {
    facts.push(`Open till ${shortTime(new Date(place.nextCloseTime))}`);
  }
  return facts;
}

function toAlternate(place: PlaceWithDistance): PlanAlternate {
  return {
    placeId: place.id,
    name: place.name,
    primaryLabel: place.primaryLabel,
    photoUrl: place.photoUrl,
    rating: place.rating,
    ratingCount: place.ratingCount,
    priceLevel: place.priceLevel,
    coordinates: place.coordinates,
    facts: factsFor(place),
  };
}

export type SolveInput = {
  start: Date;
  duration: PlanDuration;
  company: PlanCompany;
  origin: Coordinates;
  pools: CandidatePools;
  stories: HistoryItem[];
  rainy?: boolean;
  /**
   * Injectable randomness for the weighted pick — tests pass a
   * constant; ↻ gets a genuinely different deal.
   */
  rng?: () => number;
};

export type SolvedPlan = {
  stops: PlanStop[];
  legs: PlanLeg[];
  /** Slots the neighbourhood couldn't fill — the honest note's input. */
  unfilledSlots: SlotKind[];
};

/**
 * Weighted pick from the top few: the best answer usually wins, the
 * second-best sometimes, the fourth occasionally. Argmax gave every
 * user the identical plan (and made ↻ recompose the same one).
 */
function samplePick<T>(ranked: { item: T; score: number }[], rng: () => number): T {
  const top = ranked.slice(0, 4);
  const weights = top.map(({ score: s }, index) => Math.exp((s - top[0].score) / 1.2) / (index + 1));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng() * total;
  for (let i = 0; i < top.length; i++) {
    roll -= weights[i];
    if (roll <= 0) {
      return top[i].item;
    }
  }
  return top[0].item;
}

export function solvePlan(input: SolveInput): SolvedPlan | null {
  const { start, duration, company, origin, pools, stories, rainy = false, rng = Math.random } = input;
  const slots = slotTemplate(duration, company, start);

  const used = new Set<string>();
  const stops: PlanStop[] = [];
  const legs: PlanLeg[] = [];
  const unfilledSlots: SlotKind[] = [];

  let position = origin;
  let clock = new Date(start);

  for (const slot of slots) {
    const pool = poolFor(slot.kind, company, pools).filter((place) => !used.has(place.id));
    const dwellMs = DwellMinutes[slot.kind] * 60000;

    const viable = pool
      .map((place) => {
        const legSeconds = estimatedLegSeconds(position, place.coordinates);
        const arrive = new Date(clock.getTime() + legSeconds * 1000);
        const depart = new Date(arrive.getTime() + dwellMs);
        return {
          place,
          legSeconds,
          arrive,
          depart,
          score: score(place, slot.kind, company, position, rainy),
        };
      })
      .filter(({ place, arrive, depart }) => openThroughWindow(place, slot.kind, arrive, depart))
      .sort((a, b) => b.score - a.score);

    if (viable.length === 0) {
      // Thin neighbourhood: skip the slot, say so — never pad
      unfilledSlots.push(slot.kind);
      continue;
    }
    const chosen = samplePick(
      viable.map((entry) => ({ item: entry, score: entry.score })),
      rng
    );

    // Leg i connects position i-1 (the origin for i=0) to stop i
    legs.push({
      seconds: chosen.legSeconds,
      meters: Math.round(chosen.legSeconds * WalkingPaceMetersPerSecond),
    });

    used.add(chosen.place.id);
    stops.push({
      placeId: chosen.place.id,
      name: chosen.place.name,
      slotKind: slot.kind,
      primaryLabel: chosen.place.primaryLabel,
      photoUrl: chosen.place.photoUrl,
      rating: chosen.place.rating,
      ratingCount: chosen.place.ratingCount,
      priceLevel: chosen.place.priceLevel,
      coordinates: chosen.place.coordinates,
      arrive: chosen.arrive.toISOString(),
      depart: chosen.depart.toISOString(),
      nextCloseTime: chosen.place.nextCloseTime,
      facts: factsFor(chosen.place),
      alternates: viable
        .filter((entry) => entry.place.id !== chosen.place.id)
        .slice(0, 2)
        .map(({ place }) => toAlternate(place)),
    });

    position = chosen.place.coordinates;
    clock = chosen.depart;
  }

  if (stops.length === 0) {
    return null;
  }

  attachStories(stops, legs, origin, stories);
  return { stops, legs, unfilledSlots };
}

/**
 * A story rides a leg when its site sits near the straight line
 * you'll roughly walk — the "you'll cross the site of the Palace of
 * Placentia" moment, from data already fetched.
 */
const StoryDetourMeters = 150;

function attachStories(stops: PlanStop[], legs: PlanLeg[], origin: Coordinates, stories: HistoryItem[]) {
  const usedStories = new Set<number>();
  for (let i = 0; i < legs.length && i < stops.length; i++) {
    const from = i === 0 ? origin : stops[i - 1].coordinates;
    const to = stops[i].coordinates;
    const midpoint = {
      latitude: (from.latitude + to.latitude) / 2,
      longitude: (from.longitude + to.longitude) / 2,
    };
    const near = stories
      .filter((story) => !usedStories.has(story.pageId))
      .map((story) => ({ story, meters: distanceMeters(midpoint, story.coordinates) }))
      .filter(({ meters }) => meters < StoryDetourMeters)
      .sort((a, b) => a.meters - b.meters)[0];
    if (near) {
      usedStories.add(near.story.pageId);
      legs[i].story = {
        pageId: near.story.pageId,
        title: near.story.title,
        hook: near.story.extract?.match(/^.*?\.(?=\s|$)/)?.[0],
      };
    }
  }
}

/**
 * Re-base stop times on real route legs and re-check every window —
 * the "never arrive at a closed kitchen" guarantee runs here, in
 * code, against the stops' own stored closing times.
 */
export function rebaseTimes(
  solved: SolvedPlan,
  start: Date,
  realLegSeconds: (number | null)[]
): { valid: boolean } {
  let clock = new Date(start);
  for (let i = 0; i < solved.stops.length; i++) {
    const stop = solved.stops[i];
    const legSeconds = realLegSeconds[i] ?? solved.legs[i].seconds;
    solved.legs[i].seconds = legSeconds;
    const dwellMs = new Date(stop.depart).getTime() - new Date(stop.arrive).getTime();
    const arrive = new Date(clock.getTime() + legSeconds * 1000);
    const depart = new Date(arrive.getTime() + dwellMs);
    stop.arrive = arrive.toISOString();
    stop.depart = depart.toISOString();
    clock = depart;
  }
  return {
    valid: solved.stops.every((stop) => {
      if (!stop.nextCloseTime) {
        return true;
      }
      const arrive = new Date(stop.arrive);
      const depart = new Date(stop.depart);
      const mustStayOpenUntil = new Date(arrive.getTime() + (depart.getTime() - arrive.getTime()) * 0.7);
      return new Date(stop.nextCloseTime) >= mustStayOpenUntil;
    }),
  };
}
