import { Coordinates } from '@/utils/geo';

export type PlanDuration = 'hour' | 'evening' | 'halfday' | 'fullday';
export type PlanCompany = 'solo' | 'date' | 'friends' | 'family';

/** What a slot is for — drives candidate pools, dwell time, and constraints. */
export type SlotKind = 'coffee' | 'landmark' | 'activity' | 'meal' | 'drink';

export type PlanStop = {
  placeId: string;
  name: string;
  slotKind: SlotKind;
  primaryLabel?: string;
  photoUrl: string;
  rating: number;
  ratingCount?: number;
  priceLevel?: string;
  coordinates: Coordinates;
  /** ISO timestamps — estimated first, re-based on real legs. */
  arrive: string;
  depart: string;
  /** RFC3339 closing moment when known — revalidation and re-planning read this. */
  nextCloseTime?: string;
  /**
   * Claude's voice — one line on why this stop. Absent when the
   * annotation call fails; the plan stands on facts alone.
   */
  why?: string;
  /** Our APIs' voice — never the model's. */
  facts: string[];
  /** Understudies: fitted to the same window, largest score first. */
  alternates: PlanAlternate[];
};

export type PlanAlternate = {
  placeId: string;
  name: string;
  primaryLabel?: string;
  photoUrl: string;
  rating: number;
  ratingCount?: number;
  priceLevel?: string;
  coordinates: Coordinates;
  why?: string;
  facts: string[];
};

export type PlanLeg = {
  /** Leg i connects stops[i] -> stops[i+1]. */
  seconds: number;
  meters: number;
  /** e.g. "clear evening, worth it" / "bring the umbrella". */
  note?: string;
  /** A story whose site the leg passes. */
  story?: { pageId: number; title: string; hook?: string };
};

export type Plan = {
  /** Claude's title ("Golden hour to last orders") or a plain fallback. */
  title: string;
  duration: PlanDuration;
  company: PlanCompany;
  start: string;
  end: string;
  totalWalkSeconds: number;
  stops: PlanStop[];
  legs: PlanLeg[];
  /** Honest capacity note when the neighbourhood ran thin. */
  note?: string;
};
