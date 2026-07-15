import { Coordinates } from '@/utils/geo';

export type WalkingRouteStep = {
  instruction: string;
  meters: number;
  /** Segment geometry — where this step begins and where its maneuver ends. */
  start?: Coordinates;
  end?: Coordinates;
};

export type WalkingRoute = {
  seconds: number;
  meters: number;
  steps: WalkingRouteStep[];
};
