/**
 * The feed holds still (#323). On a bus, Venture used to refresh itself
 * out from under the reader: every ~111m bucket the GPS crossed refired
 * the feed fetch (every ~8s at 30mph), the dressing upgrade re-asked 4s
 * after each, the map re-cameraed per ~10m tick and the title moved as
 * the area cascade re-resolved. The reader decides when the feed
 * re-asks now — pull-to-refresh, a pin, app start — and this file is
 * the CLASS fence over the whole screen: no network ask of any kind
 * may fire from a position change alone. The ask list below is the
 * parameterisation; a new surface that asks the network belongs on it,
 * and the journey will catch one that asks while the reader merely
 * moves.
 *
 * Real hooks throughout (useHistory, useFeedOrigin, useAreaName) —
 * only the wire and the OS are mocked. Asserted on what the reader
 * gets: the rendered screen, the props the native map was handed.
 */
import { act, render } from '@testing-library/react-native';

import { HistoryArchiveScreen, StoriesScreen } from '@/components/section-screen';
import { resetAreaNameCacheForTests } from '@/hooks/use-area-name';
import { resetFeedOriginForTests } from '@/hooks/use-feed-origin';
import { clearPin, setPin } from '@/hooks/use-pin';
import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };
const alnwick: Coordinates = { latitude: 55.4135, longitude: -1.7055 };
/** North of the origin by whole metres — the story the cards measure. */
const north = (meters: number): Coordinates => ({
  latitude: greenwich.latitude + meters / 111_195,
  longitude: greenwich.longitude,
});

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/components/one-door', () => ({
  useOneDoorDismissed: () => true,
}));

const mockFetchNearbyHistory = jest.fn();
const mockHasCachedFeed = jest.fn();
jest.mock('@/data/history-client', () => ({
  fetchNearbyHistory: (...args: unknown[]) => mockFetchNearbyHistory(...args),
  hasCachedFeed: (...args: unknown[]) => mockHasCachedFeed(...args),
}));

const mockFetchArticleLight = jest.fn();
const mockFetchArticle = jest.fn();
jest.mock('@/data/article-client', () => ({
  fetchArticleLight: (...args: unknown[]) => mockFetchArticleLight(...args),
  fetchArticle: (...args: unknown[]) => mockFetchArticle(...args),
}));

const mockFetchNearestArea = jest.fn();
jest.mock('@/data/area-client', () => ({
  fetchNearestArea: (...args: unknown[]) => mockFetchNearestArea(...args),
}));

const mockFetchRetold = jest.fn();
jest.mock('@/data/retold-client', () => ({
  fetchRetold: (...args: unknown[]) => mockFetchRetold(...args),
}));

const mockFetchTelling = jest.fn();
jest.mock('@/data/telling-client', () => ({
  fetchTelling: (...args: unknown[]) => mockFetchTelling(...args),
}));

const mockReverseGeocodeAsync = jest.fn();
const mockGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: (...args: unknown[]) => mockReverseGeocodeAsync(...args),
  geocodeAsync: (...args: unknown[]) => mockGeocodeAsync(...args),
}));

const mockUpdateAreaWidget = jest.fn();
jest.mock('@/data/area-widget', () => ({
  updateAreaWidget: (...args: unknown[]) => mockUpdateAreaWidget(...args),
}));

// The wire itself, the lowest choke point: every data client above is
// mocked, so nothing rendered here should reach it — but a FUTURE
// surface that fetches directly is exactly what this fence is for.
const mockWireFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockWireFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

// What the native map is HANDED — jest-setup's global mock renders a
// View but keeps no record, and the camera is the record that matters
const mockMapProps: Record<string, unknown>[] = [];
jest.mock('expo-maps', () => {
  const Fake = (props: Record<string, unknown>) => {
    mockMapProps.push(props);
    return null;
  };
  return { AppleMaps: { View: Fake }, GoogleMaps: { View: Fake } };
});

const walkable: HistoryItem = {
  pageId: 1,
  title: 'Cutty Sark',
  coordinates: north(200),
  distanceMeters: 200,
  thumbnailUrl: 'https://img/cutty-sark.jpg',
  url: 'https://en.wikipedia.org/wiki/Cutty_Sark',
  source: 'Wikipedia',
};

const relic: HistoryItem = {
  pageId: 7,
  title: 'Palace of Placentia',
  coordinates: north(200),
  distanceMeters: 200,
  url: 'https://en.wikipedia.org/wiki/Palace_of_Placentia',
  source: 'Wikipedia',
  pastTag: 'No longer standing',
};

/**
 * EVERY network ask a feed screen can make, by name. The fence walks
 * the reader and asserts this whole ledger unmoved; a new ask-site
 * joins the ledger or the journey catches it at the wire entry.
 */
const networkAsks: [string, () => number][] = [
  ['the feed', () => mockFetchNearbyHistory.mock.calls.length],
  [
    'the dressing upgrade',
    () =>
      mockFetchNearbyHistory.mock.calls.filter(
        ([, options]) => (options as { upgrade?: boolean } | undefined)?.upgrade
      ).length,
  ],
  ['the area name: reverse geocode', () => mockReverseGeocodeAsync.mock.calls.length],
  ['the area name: nearest area', () => mockFetchNearestArea.mock.calls.length],
  ['the area name: article probes', () => mockFetchArticleLight.mock.calls.length],
  ['the gazetteer: full article', () => mockFetchArticle.mock.calls.length],
  ['the gazetteer: retelling', () => mockFetchRetold.mock.calls.length],
  ['the telling', () => mockFetchTelling.mock.calls.length],
  ['the raw wire (expo/fetch)', () => mockWireFetch.mock.calls.length],
];

const askLedger = () => Object.fromEntries(networkAsks.map(([name, count]) => [name, count()]));

function at(coordinates: Coordinates) {
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates });
}

const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  mockMapProps.length = 0;
  clearPin();
  resetFeedOriginForTests();
  resetAreaNameCacheForTests();
  at(greenwich);
  mockHasCachedFeed.mockReturnValue(false);
  mockFetchNearbyHistory.mockResolvedValue({ items: [walkable, relic] });
  // The cascade's Greenwich: the geocoder names the city, Wikipedia
  // has no nearer area-classed article, and the city's article exists
  mockReverseGeocodeAsync.mockResolvedValue([{ city: 'Greenwich' }]);
  mockGeocodeAsync.mockResolvedValue([alnwick]);
  mockFetchNearestArea.mockResolvedValue(null);
  mockFetchArticleLight.mockResolvedValue({
    minutes: 2,
    images: [],
    chapters: [{ title: '', paragraphs: ['A town on the meridian.'] }],
  });
  mockFetchArticle.mockRejectedValue(new TypeError('Network request failed'));
  mockFetchRetold.mockResolvedValue(null);
  mockFetchTelling.mockReturnValue(new Promise(() => {}));
  mockWireFetch.mockRejectedValue(new TypeError('Network request failed'));
});

describe('the class fence: no network ask fires from a position change alone (#323)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Dressing, so the one-shot upgrade timer is armed and live during
    // the ride — the churn had a second request 4s behind every first
    mockFetchNearbyHistory.mockResolvedValue({ items: [walkable, relic], dressing: true });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test.each([
    ['Nearby', StoriesScreen],
    ['History', HistoryArchiveScreen],
  ])('%s: a 5km ride moves nothing on the ask ledger', async (_tab, Screen) => {
    const screen = await render(<Screen />);
    await flush();
    // Settle fully: the dressing upgrades fire their one shot at 4s…
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await flush();
    const settled = askLedger();
    expect(settled['the feed']).toBeGreaterThan(0); // the fence watches a real feed, not an unmounted one

    // …then the bus: 20 stops of ~250m — 5km, dozens of the old
    // bucket crossings — each with a 10s window for any timer to leak
    for (let stop = 1; stop <= 20; stop++) {
      at(north(stop * 250));
      await screen.rerender(<Screen />);
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
    }
    await flush();

    expect(askLedger()).toEqual(settled);
  });

  test('Nearby: the map camera and the widget hold with the feed, and the title stays', async () => {
    const screen = await render(<StoriesScreen />);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    await flush();
    // Settled: the island names the feed's ground and the widget heard
    expect(screen.getAllByText('Greenwich').length).toBeGreaterThan(0);
    const camera = mockMapProps[mockMapProps.length - 1].cameraPosition;
    expect(camera).toBeDefined();
    const pushes = mockUpdateAreaWidget.mock.calls.length;
    expect(pushes).toBeGreaterThan(0);

    for (let stop = 1; stop <= 20; stop++) {
      at(north(stop * 250));
      await screen.rerender(<StoriesScreen />);
      await act(async () => {
        jest.advanceTimersByTime(10_000);
      });
    }
    await flush();

    // The camera still frames the ground the feed is about — it used
    // to re-frame on every ~10m tick
    expect(mockMapProps[mockMapProps.length - 1].cameraPosition).toEqual(camera);
    // The Home Screen was not told twenty times about one feed
    expect(mockUpdateAreaWidget.mock.calls.length).toBe(pushes);
    // And the title has not moved: it names what the feed shows
    expect(screen.getAllByText('Greenwich').length).toBeGreaterThan(0);
  });
});

describe('in the margin: moved since the feed was fetched (#323)', () => {
  const MovedLine = 'Showing stories from where you were — pull down for here.';

  test('inside ~500m the margin is silent; past it, one grey line offers the pull', async () => {
    const screen = await render(<StoriesScreen />);
    await flush();
    // At the origin: stories, distances, and no margin line
    expect(await screen.findByText('3 min walk · Wikipedia')).toBeOnTheScreen();
    expect(screen.queryByText(MovedLine)).toBeNull();

    // A wander inside the threshold — two or three streets over
    const wander = north(445);
    expect(distanceMeters(wander, greenwich)).toBeLessThan(500);
    at(wander);
    await screen.rerender(<StoriesScreen />);
    await flush();
    expect(screen.queryByText(MovedLine)).toBeNull();

    // Past the threshold: the line appears — and the STORIES have held
    // still while their DISTANCES kept telling the truth
    const away = north(668);
    expect(distanceMeters(away, greenwich)).toBeGreaterThanOrEqual(500);
    at(away);
    await screen.rerender(<StoriesScreen />);
    await flush();
    expect(screen.getByText(MovedLine)).toBeOnTheScreen();
    expect(screen.getByText('Cutty Sark')).toBeOnTheScreen();
    expect(screen.getByText('6 min walk · Wikipedia')).toBeOnTheScreen();
    expect(mockFetchNearbyHistory).toHaveBeenCalledTimes(2); // both Nearby surfaces' mount asks — none since
  });

  test('the pull keeps the promise: the feed re-asks from here and the line goes', async () => {
    const screen = await render(<StoriesScreen />);
    await flush();
    at(north(668));
    await screen.rerender(<StoriesScreen />);
    await flush();
    expect(screen.getByText(MovedLine)).toBeOnTheScreen();
    const asksBefore = mockFetchNearbyHistory.mock.calls.length;

    // The pull, through the list's own control — the gesture's handler
    const list = screen.getByTestId('nearby-feed');
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    await flush();

    // The re-ask is about HERE — the new ground's bucket, plainly
    expect(mockFetchNearbyHistory.mock.calls.length).toBeGreaterThan(asksBefore);
    expect(mockFetchNearbyHistory).toHaveBeenLastCalledWith({
      latitude: Number(north(668).latitude.toFixed(3)),
      longitude: Number(north(668).longitude.toFixed(3)),
    });
    // …and the margin has nothing left to say
    expect(screen.queryByText(MovedLine)).toBeNull();
  });

  test('exploring is not "moved": the pin is deliberately elsewhere and the header already says so', async () => {
    const screen = await render(<StoriesScreen />);
    await flush();
    setPin({ center: alnwick, blind: false, label: 'Alnwick' });
    await screen.rerender(<StoriesScreen />);
    await flush();

    expect(screen.getByText('Exploring')).toBeOnTheScreen();
    // Hundreds of km from the pinned origin, and rightly silent
    expect(screen.queryByText(MovedLine)).toBeNull();
  });
});
