import { arrowTowards, bearingDegrees, distanceMeters } from '@/utils/geo';

const TowerBridge = { latitude: 51.5055, longitude: -0.0754 };
const StPauls = { latitude: 51.5138, longitude: -0.0984 };

describe('distanceMeters', () => {
  test('distance to the same point is zero', () => {
    expect(distanceMeters(TowerBridge, TowerBridge)).toBe(0);
  });

  test('is symmetric', () => {
    expect(distanceMeters(TowerBridge, StPauls)).toBeCloseTo(
      distanceMeters(StPauls, TowerBridge),
      6
    );
  });

  test('Tower Bridge to St Pauls is roughly 1.8 km', () => {
    const distance = distanceMeters(TowerBridge, StPauls);
    expect(distance).toBeGreaterThan(1600);
    expect(distance).toBeLessThan(2100);
  });
});

describe('bearingDegrees', () => {
  const origin = { latitude: 51.5, longitude: -0.09 };

  test('cardinal directions', () => {
    expect(bearingDegrees(origin, { latitude: 51.51, longitude: -0.09 })).toBeCloseTo(0, 0);
    expect(bearingDegrees(origin, { latitude: 51.5, longitude: -0.08 })).toBeCloseTo(90, 0);
    expect(bearingDegrees(origin, { latitude: 51.49, longitude: -0.09 })).toBeCloseTo(180, 0);
    expect(bearingDegrees(origin, { latitude: 51.5, longitude: -0.1 })).toBeCloseTo(270, 0);
  });
});

describe('arrowTowards', () => {
  const origin = { latitude: 51.5, longitude: -0.09 };
  const north = { latitude: 51.51, longitude: -0.09 };
  const east = { latitude: 51.5, longitude: -0.08 };

  test('facing north, a northern target is straight ahead', () => {
    expect(arrowTowards(origin, north, 0)).toBe('↑');
  });

  test('facing north, an eastern target is to the right', () => {
    expect(arrowTowards(origin, east, 0)).toBe('→');
  });

  test('facing east, an eastern target is straight ahead', () => {
    expect(arrowTowards(origin, east, 90)).toBe('↑');
  });

  test('facing east, a northern target is to the left', () => {
    expect(arrowTowards(origin, north, 90)).toBe('←');
  });
});
