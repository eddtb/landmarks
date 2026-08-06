/**
 * The eviction notice, tested from both of its doors: the task iOS
 * wakes into a boundary crossing (headless — no React tree), and the
 * exported disarm the root layout calls on a foreground launch. Both
 * must leave the same state behind: flag off, table empty, flushed to
 * disk, geofencing stopped.
 */

type TaskBody = (event: {
  data?: { eventType: number; region: { identifier?: string } };
  error?: unknown;
}) => Promise<void>;

// `mock`-prefixed so jest's hoisted mock factory may close over it
let mockTaskBody: TaskBody | null = null;

const mockStopGeofencingAsync = jest.fn().mockResolvedValue(undefined);
const mockHasStartedGeofencingAsync = jest.fn().mockResolvedValue(true);

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, body: TaskBody) => {
    mockTaskBody = body;
  },
}));

jest.mock('expo-location', () => ({
  stopGeofencingAsync: (...args: unknown[]) => mockStopGeofencingAsync(...args),
  hasStartedGeofencingAsync: (...args: unknown[]) => mockHasStartedGeofencingAsync(...args),
}));

// require, not import: importing would run arrival-geofence's
// module-scope defineTask before the mock* declarations above have
// left the temporal dead zone, and the factory's assignment would
// throw. The saved-test suite uses the same idiom for the same reason.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const arrivals = require('@/data/arrivals') as typeof import('@/data/arrivals');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geofence = require('@/data/arrival-geofence') as typeof import('@/data/arrival-geofence');

beforeEach(async () => {
  jest.clearAllMocks();
  mockHasStartedGeofencingAsync.mockResolvedValue(true);
  mockStopGeofencingAsync.mockResolvedValue(undefined);
  arrivals.setArrivalsForTests({ enabled: true });
  await arrivals.arrivalsHydrated;
});

async function expectDisarmedState() {
  expect(arrivals.arrivalsEnabled()).toBe(false);
  expect(arrivals.armedRegions()).toEqual([]);
}

describe('the task is still registered — as the disarm', () => {
  it('exists, so a wake into this bundle is not an unhandled-task error', () => {
    expect(mockTaskBody).not.toBeNull();
  });

  it('a boundary crossing dismantles the geofences instead of announcing', async () => {
    await mockTaskBody!({ data: { eventType: 1, region: { identifier: '42' } } });

    await expectDisarmedState();
    expect(mockStopGeofencingAsync).toHaveBeenCalledWith(geofence.ArrivalTaskName);
  });
});

describe('disarmArrivals', () => {
  it('turns the flag off, empties the table, and stops monitoring', async () => {
    await geofence.disarmArrivals();

    await expectDisarmedState();
    expect(mockHasStartedGeofencingAsync).toHaveBeenCalledWith(geofence.ArrivalTaskName);
    expect(mockStopGeofencingAsync).toHaveBeenCalledWith(geofence.ArrivalTaskName);
  });

  it('skips the stop when CoreLocation was never monitoring', async () => {
    mockHasStartedGeofencingAsync.mockResolvedValue(false);

    await geofence.disarmArrivals();

    await expectDisarmedState();
    expect(mockStopGeofencingAsync).not.toHaveBeenCalled();
  });

  it('never throws — a failed disarm on a pocketed phone retries next launch', async () => {
    mockStopGeofencingAsync.mockRejectedValue(new Error('CoreLocation said no'));

    await expect(geofence.disarmArrivals()).resolves.toBeUndefined();
    await expectDisarmedState();
  });

  it('is idempotent across the two doors racing', async () => {
    await Promise.all([
      geofence.disarmArrivals(),
      mockTaskBody!({ data: { eventType: 1, region: { identifier: '7' } } }),
    ]);

    await expectDisarmedState();
  });
});
