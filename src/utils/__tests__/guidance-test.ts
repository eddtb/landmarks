import { guidanceFor, stepsFrom } from '@/utils/guidance';

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
