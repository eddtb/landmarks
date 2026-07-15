import { mapWalkingRoute } from '@/server/google-routes';

describe('mapWalkingRoute', () => {
  test('maps duration, distance, and instruction steps', () => {
    const route = mapWalkingRoute({
      routes: [
        {
          duration: '302s',
          distanceMeters: 344,
          legs: [
            {
              steps: [
                {
                  distanceMeters: 22,
                  navigationInstruction: { instructions: 'Head east on Middle Rd' },
                },
                { distanceMeters: 5 }, // no instruction — dropped
                {
                  distanceMeters: 201,
                  navigationInstruction: { instructions: 'Turn right onto St Thomas St' },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(route).toEqual({
      seconds: 302,
      meters: 344,
      steps: [
        { instruction: 'Head east on Middle Rd', meters: 22 },
        { instruction: 'Turn right onto St Thomas St', meters: 201 },
      ],
    });
  });

  test('returns null when there is no route', () => {
    expect(mapWalkingRoute({})).toBeNull();
    expect(mapWalkingRoute({ routes: [] })).toBeNull();
  });
});
