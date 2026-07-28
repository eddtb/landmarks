import { HistoryItem } from '@/types/history';

/**
 * The geofence task is the half that runs when nobody is looking: a
 * cold JS runtime, woken by iOS, holding a region identifier and
 * nothing else. These tests drive the registered handler directly —
 * the same entry point CoreLocation uses.
 */

type TaskBody = (event: {
  data?: { eventType: number; region: { identifier?: string } };
  error?: unknown;
}) => Promise<void>;

// `mock`-prefixed so jest's hoisted mock factory may close over it
let mockTaskBody: TaskBody | null = null;

const mockScheduleNotificationAsync = jest.fn().mockResolvedValue('id');
const mockStartGeofencingAsync = jest.fn().mockResolvedValue(undefined);
const mockStopGeofencingAsync = jest.fn().mockResolvedValue(undefined);
const mockHasStartedGeofencingAsync = jest.fn().mockResolvedValue(true);
const mockRequestForegroundPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });
const mockRequestBackgroundPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });
const mockRequestNotificationPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, body: TaskBody) => {
    mockTaskBody = body;
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: (...args: unknown[]) => mockScheduleNotificationAsync(...args),
  requestPermissionsAsync: (...args: unknown[]) => mockRequestNotificationPermissionsAsync(...args),
  AndroidImportance: { DEFAULT: 3 },
}));

jest.mock('expo-location', () => ({
  GeofencingEventType: { Enter: 1, Exit: 2 },
  startGeofencingAsync: (...args: unknown[]) => mockStartGeofencingAsync(...args),
  stopGeofencingAsync: (...args: unknown[]) => mockStopGeofencingAsync(...args),
  hasStartedGeofencingAsync: (...args: unknown[]) => mockHasStartedGeofencingAsync(...args),
  requestForegroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestForegroundPermissionsAsync(...args),
  requestBackgroundPermissionsAsync: (...args: unknown[]) =>
    mockRequestBackgroundPermissionsAsync(...args),
}));

// require, not import: importing would run arrival-geofence's
// module-scope defineTask before the mock* declarations above have
// left the temporal dead zone, and the factory's assignment would
// throw. The saved-test suite uses the same idiom for the same reason.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const arrivals = require('@/data/arrivals') as typeof import('@/data/arrivals');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const geofence = require('@/data/arrival-geofence') as typeof import('@/data/arrival-geofence');

const item = (
  pageId: number,
  title: string,
  distanceMeters: number,
  extra: Partial<HistoryItem> = {}
): HistoryItem => ({
  pageId,
  title,
  // Distinct ground per place by default (~111m apart): the selection
  // spends one slot per patch of ground, so a shared coordinate would
  // silently collapse fixtures that are about ordering, not geography
  coordinates: { latitude: 51.48 + pageId / 1000, longitude: 0 },
  distanceMeters,
  extract: `${title} was a debtors' prison that stood for two centuries.`,
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
  ...extra,
});

const enter = (identifier: string) =>
  mockTaskBody!({ data: { eventType: 1, region: { identifier } } });

beforeEach(async () => {
  jest.clearAllMocks();
  arrivals.setArrivalsForTests({ enabled: true });
  await arrivals.arrivalsHydrated;
});

describe('the wake', () => {
  it('names the place it arrived at, from disk, with no network', async () => {
    arrivals.setArmedRegions(arrivals.selectArrivalRegions([item(42, 'The Marshalsea', 10)], []));

    await enter('42');

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const [{ content, trigger }] = mockScheduleNotificationAsync.mock.calls[0];
    expect(content.title).toBe('The Marshalsea');
    expect(content.body).toContain("debtors' prison");
    // The tap has to land on the story, not just open the app
    expect(content.data).toEqual({ pageId: 42 });
    // null trigger is "now" — a geofence crossing is not a schedule
    expect(trigger).toBeNull();
  });

  it('says its piece once, however many times you cross', async () => {
    arrivals.setArmedRegions(arrivals.selectArrivalRegions([item(42, 'The Marshalsea', 10)], []));

    await enter('42');
    await enter('42');
    await enter('42');

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('is one banner per arrival when a whole cluster is crossed at once', async () => {
    // The measured shape of the bug: arriving in Westminster woke the
    // task NINETEEN times inside 127ms. Every wake passed the quiet
    // check before any of them had written the mark, so all nineteen
    // announced. These must be delivered CONCURRENTLY — awaiting them
    // one at a time passes against the broken code too.
    const cluster = Array.from({ length: 19 }, (_, index) =>
      item(200 + index, `Place ${index}`, 10 + index)
    );
    arrivals.setArmedRegions(arrivals.selectArrivalRegions(cluster, []));

    await Promise.all(cluster.map((place) => enter(String(place.pageId))));

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('lets the next place speak once the quiet period has lapsed', async () => {
    arrivals.setArmedRegions(
      arrivals.selectArrivalRegions([item(1, 'The Mill', 10), item(2, 'The Wharf', 20)], [])
    );

    await enter('1');
    // Walking on: the quiet period is a debounce, not a rate limit
    const later = Date.now() + arrivals.AnnounceQuietMs + 1;
    jest.spyOn(Date, 'now').mockReturnValue(later);
    await enter('2');
    jest.spyOn(Date, 'now').mockRestore();

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('stays silent for a crossing delivered after the user opted out', async () => {
    arrivals.setArmedRegions(arrivals.selectArrivalRegions([item(42, 'The Marshalsea', 10)], []));
    arrivals.setArrivalsEnabled(false);

    await enter('42');

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('stays silent for a region it has no name for', async () => {
    arrivals.setArmedRegions(arrivals.selectArrivalRegions([item(42, 'The Marshalsea', 10)], []));

    await enter('999');

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('ignores an exit — leaving is not news', async () => {
    arrivals.setArmedRegions(arrivals.selectArrivalRegions([item(42, 'The Marshalsea', 10)], []));

    await mockTaskBody!({ data: { eventType: 2, region: { identifier: '42' } } });

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('swallows a delivered error rather than crashing a backgrounded app', async () => {
    await expect(mockTaskBody!({ error: new Error('region monitoring failed') })).resolves.toBeUndefined();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('survives a malformed identifier', async () => {
    await expect(enter('not-a-page-id')).resolves.toBeUndefined();
    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('what the banner says', () => {
  it('gives the reason to look up', () => {
    const text = geofence.arrivalNotificationText({
      pageId: 1,
      title: 'The Marshalsea',
      coordinates: { latitude: 51.48, longitude: 0 },
      hook: 'A debtors’ prison that stood for two centuries.',
    });
    expect(text).toEqual({
      title: 'The Marshalsea',
      body: 'A debtors’ prison that stood for two centuries.',
    });
  });

  it('keeps a hook that opens with the place name — most of Wikipedia does', () => {
    // The card would drop this one; a banner that dropped it would
    // have nothing left to say
    const text = geofence.arrivalNotificationText({
      pageId: 1,
      title: 'The Marshalsea',
      coordinates: { latitude: 51.48, longitude: 0 },
      hook: 'The Marshalsea was a debtors’ prison that stood for two centuries.',
    });
    expect(text.body).toContain('debtors’ prison');
  });

  it("does not say the same thing twice when a plaque's hook echoes its title", () => {
    const text = geofence.arrivalNotificationText({
      pageId: 1,
      title: 'Ada Lovelace lived here',
      coordinates: { latitude: 51.48, longitude: 0 },
      hook: 'Ada Lovelace lived here 1815-1852.',
    });
    expect(text.body).toBe("You're standing right here.");
  });

  it('falls back when there is no hook at all', () => {
    const text = geofence.arrivalNotificationText({
      pageId: 1,
      title: 'A Bare Place',
      coordinates: { latitude: 51.48, longitude: 0 },
    });
    expect(text.body).toBe("You're standing right here.");
  });
});

describe('arming', () => {
  it('writes the table before arming — a crossing can land immediately', async () => {
    const order: string[] = [];
    mockStartGeofencingAsync.mockImplementation(async () => {
      order.push(`armed:${arrivals.armedRegions().length}`);
    });

    await geofence.syncArrivalRegions([item(1, 'The Mill', 10)], []);

    expect(order).toEqual(['armed:1']);
  });

  it('passes CoreLocation an enter-only region per place', async () => {
    await geofence.syncArrivalRegions(
      [item(1, 'The Mill', 10, { coordinates: { latitude: 51.481, longitude: 0 } })],
      []
    );

    const [taskName, regions] = mockStartGeofencingAsync.mock.calls[0];
    expect(taskName).toBe(geofence.ArrivalTaskName);
    expect(regions).toEqual([
      {
        identifier: '1',
        latitude: 51.481,
        longitude: 0,
        radius: arrivals.ArrivalRadiusMeters,
        notifyOnEnter: true,
        notifyOnExit: false,
      },
    ]);
  });

  it('does not re-arm an unchanged set — re-arming drops a crossing in progress', async () => {
    await geofence.syncArrivalRegions([item(1, 'The Mill', 10)], []);
    await geofence.syncArrivalRegions([item(1, 'The Mill', 12)], []);

    expect(mockStartGeofencingAsync).toHaveBeenCalledTimes(1);
  });

  it('re-arms when the ground actually changes', async () => {
    await geofence.syncArrivalRegions([item(1, 'The Mill', 10)], []);
    await geofence.syncArrivalRegions([item(2, 'The Wharf', 10)], []);

    expect(mockStartGeofencingAsync).toHaveBeenCalledTimes(2);
  });

  it('announces a place the user is already standing inside when it arms', async () => {
    // The crossing that never arrives: CoreLocation delivers no
    // didEnterRegion for a region you are already within when
    // monitoring starts, and this app re-arms every ~111m against a
    // 120m radius. Measured on the simulator — walking 220m to the
    // Cutty Sark left the app inside FOUR armed regions in silence.
    await geofence.syncArrivalRegions([item(1, 'Cutty Sark', 0)], []);

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync.mock.calls[0][0].content.title).toBe('Cutty Sark');
  });

  it('picks the nearest of several it is standing inside, and only that one', async () => {
    await geofence.syncArrivalRegions(
      [
        item(1, 'New Zealand Memorial', 71),
        item(2, 'Cutty Sark', 0),
        item(3, 'Statue of Sir Walter Raleigh', 82),
      ],
      []
    );

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(mockScheduleNotificationAsync.mock.calls[0][0].content.title).toBe('Cutty Sark');
  });

  it('stays silent when arming somewhere it has not yet reached', async () => {
    await geofence.syncArrivalRegions([item(1, 'The Mill', 300)], []);

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not trust a saved place’s stale distance to mean "here"', async () => {
    // A shelf entry's distanceMeters was minted wherever the feed that
    // saved it was fetched — possibly another town (see saved.ts)
    await geofence.syncArrivalRegions([], [item(1, 'Saved Elsewhere', 0)]);

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('arms nothing while the user has not opted in', async () => {
    arrivals.setArrivalsForTests({ enabled: false });

    await geofence.syncArrivalRegions([item(1, 'The Mill', 10)], []);

    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
  });

  it('leaves the armed set alone when there is nothing to arm', async () => {
    await geofence.syncArrivalRegions([item(1, 'The Mill', 10)], []);
    await geofence.syncArrivalRegions([], []);

    expect(mockStartGeofencingAsync).toHaveBeenCalledTimes(1);
    expect(arrivals.armedRegions()).toHaveLength(1);
  });
});

describe('the toggle', () => {
  it('refuses to arm when notifications are declined', async () => {
    arrivals.setArrivalsForTests({ enabled: false });
    mockRequestNotificationPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await expect(geofence.enableArrivals()).resolves.toBe(
      'denied-notifications'
    );
    expect(arrivals.arrivalsEnabled()).toBe(false);
    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
  });

  it('refuses to arm when background location is declined', async () => {
    arrivals.setArrivalsForTests({ enabled: false });
    mockRequestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await expect(geofence.enableArrivals()).resolves.toBe(
      'denied-location'
    );
    expect(arrivals.arrivalsEnabled()).toBe(false);
  });

  it('never asks for background before foreground is granted', async () => {
    arrivals.setArrivalsForTests({ enabled: false });
    mockRequestForegroundPermissionsAsync.mockResolvedValueOnce({ granted: false });

    await geofence.enableArrivals();

    expect(mockRequestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('remembers the choice once everything is granted, and leaves arming to the feed', async () => {
    arrivals.setArrivalsForTests({ enabled: false });

    await expect(geofence.enableArrivals()).resolves.toBe('granted');
    expect(arrivals.arrivalsEnabled()).toBe(true);
    // The feed owns arming (useArrivalsSync) — it is what knows where
    // the user is. Flipping the flag is what makes its effect run.
    expect(mockStartGeofencingAsync).not.toHaveBeenCalled();
  });

  it('stops being woken when switched off', async () => {
    await geofence.disableArrivals();

    expect(mockStopGeofencingAsync).toHaveBeenCalledWith(geofence.ArrivalTaskName);
    expect(arrivals.arrivalsEnabled()).toBe(false);
    expect(arrivals.armedRegions()).toEqual([]);
  });

  it('does not stop a task that was never started', async () => {
    mockHasStartedGeofencingAsync.mockResolvedValueOnce(false);

    await geofence.disableArrivals();

    expect(mockStopGeofencingAsync).not.toHaveBeenCalled();
  });
});
