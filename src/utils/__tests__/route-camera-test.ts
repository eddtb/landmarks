import { cameraForRoute } from '@/utils/route-camera';

describe('cameraForRoute', () => {
  test('centers on the bounding box of the points', () => {
    const camera = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.51, longitude: -0.07 },
    ]);

    expect(camera?.coordinates.latitude).toBeCloseTo(51.505);
    expect(camera?.coordinates.longitude).toBeCloseTo(-0.08);
  });

  test('zooms out as the route gets longer', () => {
    const shortWalk = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.505, longitude: -0.09 },
    ]);
    const longWalk = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.53, longitude: -0.09 },
    ]);

    expect(shortWalk!.zoom).toBeGreaterThan(longWalk!.zoom);
  });

  test('a one-block hop does not over-zoom past the ceiling', () => {
    const camera = cameraForRoute([
      { latitude: 51.5, longitude: -0.09 },
      { latitude: 51.5001, longitude: -0.09 },
    ]);

    expect(camera!.zoom).toBeLessThanOrEqual(17);
  });

  test('a cross-city span clamps to the zoom floor', () => {
    const camera = cameraForRoute([
      { latitude: 51.4, longitude: -0.2 },
      { latitude: 51.6, longitude: 0.1 },
    ]);

    expect(camera!.zoom).toBe(12);
  });

  test('no points, no camera', () => {
    expect(cameraForRoute([])).toBeNull();
  });
});
