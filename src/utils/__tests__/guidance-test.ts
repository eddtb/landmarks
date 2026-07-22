import {
  distanceToRouteMeters,
  guidanceFor,
  needsReroute,
  RouteCorridorMeters,
  stepsFrom,
} from '@/utils/guidance';

// A two-leg route: north up a street, then east to the corner —
// shaped like the Valhalla client type (shape points + maneuvers)
const route = {
  seconds: 300,
  meters: 400,
  coordinates: [
    { latitude: 51.4, longitude: 0 },
    { latitude: 51.401, longitude: 0 },
    { latitude: 51.402, longitude: 0 }, // corner: turn east
    { latitude: 51.402, longitude: 0.002 }, // destination
  ],
  maneuvers: [
    { instruction: 'Walk north on Royal Hill.', meters: 222, beginIndex: 0 },
    { instruction: 'Turn right onto the corner.', meters: 140, beginIndex: 2 },
    { instruction: 'You have arrived.', meters: 0, beginIndex: 3 },
  ],
};

describe('stepsFrom', () => {
  test('each leg runs to the next maneuver; the zero-length arrival folds away', () => {
    const steps = stepsFrom(route);
    expect(steps).toHaveLength(2); // Valhalla's trailing arrival is not a leg
    expect(steps[0].start).toEqual({ latitude: 51.4, longitude: 0 });
    expect(steps[0].end).toEqual({ latitude: 51.402, longitude: 0 });
    expect(steps[1].end).toEqual({ latitude: 51.402, longitude: 0.002 });
  });
});

describe('guidanceFor (satnav logic, venue-era, back on free routes)', () => {
  test('on the first leg: needle at the corner, distance counting down', () => {
    const guidance = guidanceFor(route, { latitude: 51.4005, longitude: 0.0001 });
    expect(guidance?.step.instruction).toBe('Walk north on Royal Hill.');
    expect(guidance?.target).toEqual({ latitude: 51.402, longitude: 0 });
    expect(guidance?.metersToManeuver).toBeGreaterThan(100);
    expect(guidance?.arrived).toBe(false);
  });

  test('within 20m of the corner: advance to the turn instruction', () => {
    const guidance = guidanceFor(route, { latitude: 51.40199, longitude: 0 });
    expect(guidance?.step.instruction).toBe('Turn right onto the corner.');
  });

  test('at the destination: arrived', () => {
    const guidance = guidanceFor(route, { latitude: 51.402, longitude: 0.00199 });
    expect(guidance?.arrived).toBe(true);
  });

  test('an empty route guides nobody', () => {
    expect(guidanceFor({ ...route, coordinates: [], maneuvers: [] }, route.coordinates[0])).toBeNull();
  });
});

describe('the route corridor (issue #197 — refetch only on leaving the route)', () => {
  const destination = route.coordinates[route.coordinates.length - 1];
  const corridor = { route, target: destination };
  // At 51.4°N a degree of longitude is ~69.5km, so 0.0003° ≈ 21m
  // off the north-running leg and 0.0006° ≈ 42m off it.

  test('distance to the polyline: on the line is ~0, beside it is the offset', () => {
    expect(distanceToRouteMeters(route, { latitude: 51.401, longitude: 0 })).toBeLessThan(1);
    const beside = distanceToRouteMeters(route, { latitude: 51.401, longitude: 0.0003 });
    expect(beside).toBeGreaterThan(15);
    expect(beside).toBeLessThan(RouteCorridorMeters);
  });

  test('a tick on the route asks for nothing', () => {
    expect(needsReroute(corridor, { latitude: 51.4005, longitude: 0.0001 }, destination)).toBe(
      false,
    );
  });

  test('GPS jitter inside the corridor (~21m off) asks for nothing', () => {
    expect(needsReroute(corridor, { latitude: 51.401, longitude: 0.0003 }, destination)).toBe(
      false,
    );
  });

  test('drifting past the corridor (~42m off) is due a re-route', () => {
    expect(needsReroute(corridor, { latitude: 51.401, longitude: 0.0006 }, destination)).toBe(true);
  });

  test('a changed destination is due a re-route even on the old route', () => {
    const elsewhere = { latitude: 51.41, longitude: 0.01 };
    expect(needsReroute(corridor, { latitude: 51.401, longitude: 0 }, elsewhere)).toBe(true);
  });

  test('no route yet: always ask', () => {
    expect(needsReroute(null, { latitude: 51.4, longitude: 0 }, destination)).toBe(true);
  });
});
