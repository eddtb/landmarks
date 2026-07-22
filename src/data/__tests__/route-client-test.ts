import { fetch } from 'expo/fetch';

import { fetchRoute } from '@/data/route-client';
import { Coordinates } from '@/utils/geo';
import { needsReroute, RouteCorridor } from '@/utils/guidance';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const mockFetch = fetch as unknown as jest.Mock;

// A wire-level "server": routes a straight line from wherever it is
// asked to the destination — enough shape for corridor math to bite
beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url: string) => {
    const params = new URL(url).searchParams;
    const from = { latitude: Number(params.get('fromLat')), longitude: Number(params.get('fromLng')) };
    const to = { latitude: Number(params.get('toLat')), longitude: Number(params.get('toLng')) };
    return {
      ok: true,
      json: async () => ({
        route: {
          coordinates: [from, to],
          maneuvers: [
            { instruction: 'Walk to the landmark.', meters: 1000, beginIndex: 0 },
            { instruction: 'You have arrived.', meters: 0, beginIndex: 1 },
          ],
          meters: 1000,
          seconds: 720,
        },
      }),
    };
  });
});

/**
 * A 1km walk due north as ~90 GPS ticks: one every ~11m of latitude,
 * with ~2m of alternating longitude jitter — a phone in a pocket.
 * (Distinct destinations per test keep the module session cache from
 * cross-talking between replays.)
 */
function walkTicks(startLat: number, lng: number, count = 90): Coordinates[] {
  const ticks: Coordinates[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push({
      latitude: startLat + i * 0.0001,
      longitude: lng + (i % 2 === 0 ? 0.00003 : -0.00003),
    });
  }
  return ticks;
}

describe('route asks during a navigation session (issue #197)', () => {
  test('BEFORE (the burn): every tick through fetchRoute = a network ask per ~27m bucket', async () => {
    const target = { latitude: 51.509, longitude: -0.01 };
    // The old effect refetched on every coordinate change; the only
    // shield was the 1/4000° origin bucket in the session cache
    for (const tick of walkTicks(51.5, -0.01)) {
      await fetchRoute(tick, target);
    }
    // 1km of latitude crosses 37 origin buckets — 37 Valhalla asks for
    // one walk, ~1/8 of the free server's 300/day politeness budget
    expect(mockFetch).toHaveBeenCalledTimes(37);
  });

  test('AFTER: the corridor rule makes it ONE ask for the whole on-route walk', async () => {
    const target = { latitude: 51.509, longitude: -0.02 };
    let corridor: RouteCorridor | null = null;
    for (const tick of walkTicks(51.5, -0.02)) {
      // The go.tsx effect, distilled: judge the tick locally first
      if (needsReroute(corridor, tick, target)) {
        corridor = { route: await fetchRoute(tick, target), target };
      }
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('AFTER: drifting off the route asks exactly once more, and the new route is the new corridor', async () => {
    const target = { latitude: 51.509, longitude: -0.03 };
    let corridor: RouteCorridor | null = null;
    const replay = async (tick: Coordinates) => {
      if (needsReroute(corridor, tick, target)) {
        corridor = { route: await fetchRoute(tick, target), target };
      }
    };

    // On-route for the first 40 ticks
    for (const tick of walkTicks(51.5, -0.03, 40)) {
      await replay(tick);
    }
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // A wrong turn: ~50m west of the route — one re-route is due
    const strayed = { latitude: 51.504, longitude: -0.0307 };
    await replay(strayed);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Walking the recovery route (straight line strayed → target)
    // asks for nothing further
    for (let i = 1; i <= 10; i++) {
      await replay({
        latitude: strayed.latitude + (i / 20) * (target.latitude - strayed.latitude),
        longitude: strayed.longitude + (i / 20) * (target.longitude - strayed.longitude),
      });
    }
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
