export type WalkingRouteStep = {
  instruction: string;
  meters: number;
};

export type WalkingRoute = {
  seconds: number;
  meters: number;
  steps: WalkingRouteStep[];
};
