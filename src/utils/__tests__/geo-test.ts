import { distanceMeters } from '@/utils/geo';

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
