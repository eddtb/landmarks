import { buildRoute, decodePolyline6 } from '@/server/route';

// Recorded from the live FOSSGIS Valhalla server, 2026-07-21:
// Royal Hill → Cutty Sark, 0.573 km, 8 maneuvers
const LiveShapePrefix = 'uh~daB`dS]`B{E~B{NzGcFdDgCyBcB}AeD{E_M}O{CiC_EyCcJgHwPyOw@nD';

describe('decodePolyline6', () => {
  const points = decodePolyline6(LiveShapePrefix);

  test('decodes the live shape to coordinates at the right place', () => {
    // First point is the route origin near Royal Hill, Greenwich
    expect(points[0].latitude).toBeCloseTo(51.4782, 3);
    expect(points[0].longitude).toBeCloseTo(-0.0103, 3);
    // Everything stays in Greenwich, nothing shoots off to (0,0)
    for (const point of points) {
      expect(point.latitude).toBeGreaterThan(51.4);
      expect(point.latitude).toBeLessThan(51.6);
      expect(point.longitude).toBeGreaterThan(-0.1);
      expect(point.longitude).toBeLessThan(0.1);
    }
    expect(points.length).toBeGreaterThan(10);
  });
});

describe('buildRoute', () => {
  test('shapes the live response into coordinates, maneuvers and totals', () => {
    const route = buildRoute({
      summary: { length: 0.573, time: 401.763 },
      legs: [
        {
          shape: LiveShapePrefix,
          maneuvers: [
            { instruction: 'Walk northwest on Royal Hill.', length: 0.061, begin_shape_index: 0 },
            {
              instruction: 'Turn right onto Greenwich High Road.',
              length: 0.14,
              begin_shape_index: 4,
            },
          ],
        },
      ],
    });

    expect(route).not.toBeNull();
    expect(route!.meters).toBe(573);
    expect(route!.seconds).toBe(402);
    expect(route!.maneuvers).toEqual([
      { instruction: 'Walk northwest on Royal Hill.', meters: 61, beginIndex: 0 },
      { instruction: 'Turn right onto Greenwich High Road.', meters: 140, beginIndex: 4 },
    ]);
  });

  test('no shape, no route', () => {
    expect(buildRoute({ legs: [{}] })).toBeNull();
  });
});
