/**
 * What a WALK costs the router (#197), asked of the screen that walks.
 *
 * `route-client-test.ts` fenced this by writing the corridor loop
 * itself — `if (needsReroute(...)) corridor = await fetchRoute(...)` —
 * and then counting the asks that loop made. It was asserting that its
 * own five lines worked. The one caller that matters, `go.tsx`, had no
 * test at all: delete the `needsReroute` guard from its effect and
 * every walk fires ~37 Valhalla asks again, with that file green.
 *
 * So the walk is replayed through GoScreen. `fetchRoute` is REAL here
 * and only `expo/fetch` is stood in for, which makes the count a count
 * of requests that would have left the phone — the ~1/8 of the free
 * community server's 300/day politeness budget #197 was about.
 */
import { act, render, screen } from '@testing-library/react-native';

import GoScreen from '@/app/history/[pageId]/go';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

jest.mock('expo-router', () => ({
  router: { back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ pageId: '42' }),
}));

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  ...jest.requireActual('@/hooks/use-location'),
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: { value: 0 }, available: false }),
}));

const mockCachedItem = jest.fn();
jest.mock('@/data/history-client', () => ({
  getCachedHistoryItem: () => mockCachedItem(),
}));

/**
 * The destination is a parameter because `route-client.ts` keeps a
 * module-level session cache on the ~27m origin grid, and a shared
 * destination would let one walk answer the next one's asks.
 */
function destination(longitude: number): HistoryItem {
  return {
    pageId: 42,
    title: 'Winchester Palace',
    coordinates: { latitude: 51.509, longitude },
    distanceMeters: 1000,
    url: 'https://en.wikipedia.org/wiki/Winchester_Palace',
    source: 'Wikipedia',
  };
}

/**
 * A 1km walk due north as ~90 GPS ticks: one every ~11m of latitude,
 * with ~2m of alternating longitude jitter — a phone in a pocket.
 */
function walkTicks(longitude: number, count = 90): Coordinates[] {
  return Array.from({ length: count }, (_, index) => ({
    latitude: 51.5 + index * 0.0001,
    longitude: longitude + (index % 2 === 0 ? 0.00003 : -0.00003),
  }));
}

/** How many asks actually reached the router. */
const routeAsks = () =>
  mockFetch.mock.calls.filter((call) => String(call[0]).includes('/api/route')).length;

/** The wire: a straight line from wherever it is asked to the target. */
function serveStraightLines() {
  mockFetch.mockImplementation(async (url: string) => {
    const params = new URL(String(url)).searchParams;
    const from = {
      latitude: Number(params.get('fromLat')),
      longitude: Number(params.get('fromLng')),
    };
    const to = { latitude: Number(params.get('toLat')), longitude: Number(params.get('toLng')) };
    return {
      ok: true,
      status: 200,
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
}

/** Feed the screen one GPS tick and let its effect settle. */
async function tick(at: Coordinates, rerender: () => Promise<unknown>) {
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: at });
  await act(async () => {
    await rerender();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  serveStraightLines();
});

describe('Go, walked', () => {
  test('a 1km walk on the route asks the router ONCE', async () => {
    const target = destination(-0.11);
    mockCachedItem.mockReturnValue(target);
    const ticks = walkTicks(-0.11);

    mockUseLocation.mockReturnValue({ status: 'ready', coordinates: ticks[0] });
    const view = await render(<GoScreen />);
    for (const at of ticks.slice(1)) {
      await tick(at, () => view.rerender(<GoScreen />));
    }

    // 1km of latitude crosses 37 of the session cache's ~27m origin
    // buckets. Without the corridor rule that is 37 Valhalla asks for
    // one walk; with it, the walk is judged on the phone.
    expect(routeAsks()).toBe(1);
  });

  test('…and the live step still moves, so the saving costs the reader nothing', async () => {
    const target = destination(-0.12);
    mockCachedItem.mockReturnValue(target);
    const ticks = walkTicks(-0.12);

    mockUseLocation.mockReturnValue({ status: 'ready', coordinates: ticks[0] });
    const view = await render(<GoScreen />);
    expect(await screen.findByText('1.0 km to next turn')).toBeOnTheScreen();

    // Halfway: the sheet has counted down without asking anything
    for (const at of ticks.slice(1, 45)) {
      await tick(at, () => view.rerender(<GoScreen />));
    }
    expect(screen.queryByText('1.0 km to next turn')).toBeNull();
    expect(screen.getByText(/to next turn/)).toBeOnTheScreen();

    for (const at of ticks.slice(45)) {
      await tick(at, () => view.rerender(<GoScreen />));
    }
    // Recomputed locally from the same route, all the way in
    expect(screen.getByText('You have arrived')).toBeOnTheScreen();
    expect(routeAsks()).toBe(1);
  });

  test('a wrong turn asks exactly once more, and the recovery route is the new corridor', async () => {
    const target = destination(-0.13);
    mockCachedItem.mockReturnValue(target);
    const ticks = walkTicks(-0.13, 40);

    mockUseLocation.mockReturnValue({ status: 'ready', coordinates: ticks[0] });
    const view = await render(<GoScreen />);
    for (const at of ticks.slice(1)) {
      await tick(at, () => view.rerender(<GoScreen />));
    }
    expect(routeAsks()).toBe(1);

    // ~50m west of the route: outside the 35m corridor, one re-route due
    const strayed = { latitude: 51.504, longitude: -0.1307 };
    await tick(strayed, () => view.rerender(<GoScreen />));
    expect(routeAsks()).toBe(2);

    // Walking the recovery route asks for nothing further
    for (let step = 1; step <= 10; step++) {
      await tick(
        {
          latitude: strayed.latitude + (step / 20) * (target.coordinates.latitude - strayed.latitude),
          longitude:
            strayed.longitude + (step / 20) * (target.coordinates.longitude - strayed.longitude),
        },
        () => view.rerender(<GoScreen />)
      );
    }
    expect(routeAsks()).toBe(2);
  });

  test('no route to be had: the compass stands in, and the screen says so', async () => {
    mockCachedItem.mockReturnValue(destination(-0.14));
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.5, longitude: -0.14 },
    });

    await render(<GoScreen />);

    expect(await screen.findByText('No walking route available — compass it is.')).toBeOnTheScreen();
  });
});
