/**
 * The Exploring header (approved Option B): a manual pin is a mode the
 * header admits to — accent EXPLORING eyebrow, hollow locator dot, and
 * a worded way home. The gate underneath obeys location-first: a pin
 * dropped blind (no GPS at the time) releases itself the moment a real
 * fix arrives; a pin dropped deliberately holds until "Back to near me".
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';

import {
  GateProps,
  HistoryArchiveScreen,
  HistoryBody,
  LocationGate,
  StoriesScreen,
} from '@/components/section-screen';
import { clearPin } from '@/hooks/use-pin';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };
const alnwick: Coordinates = { latitude: 55.4135, longitude: -1.7055 };

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

// Area names keyed off the center so tests can read where the app is
jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: (center: Coordinates) => ({
    name: center.latitude === 55.4135 ? 'Alnwick' : 'Greenwich',
    settled: true,
  }),
}));

const mockGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  geocodeAsync: (...args: unknown[]) => mockGeocodeAsync(...args),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

// The Gazetteer hero is its own tested surface — a stub keeps these
// tests on the header
jest.mock('@/components/area-gazetteer', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  return { AreaGazetteer: () => <RNText>gazetteer body</RNText> };
});

function gpsLive() {
  mockUseLocation.mockReturnValue({
    status: 'ready',
    coordinates: greenwich,
    requestPermission: jest.fn(),
  });
}

function gpsDenied() {
  mockUseLocation.mockReturnValue({
    status: 'denied',
    coordinates: null,
    requestPermission: jest.fn(),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  // The pin store is module-level and app-wide — start every test unpinned
  clearPin();
  mockGeocodeAsync.mockResolvedValue([{ latitude: alnwick.latitude, longitude: alnwick.longitude }]);
  mockUseHistory.mockReturnValue({ state: { status: 'ready', items: [] }, refresh: jest.fn() });
});

/** Drive the header's search: open via the title, type, submit. */
async function searchFor(screen: Awaited<ReturnType<typeof render>>, query: string) {
  await fireEvent.press(screen.getByTestId('area-title'));
  const input = screen.getByPlaceholderText('Search near a place…');
  await fireEvent.changeText(input, query);
  await fireEvent(input, 'submitEditing');
}

describe('LocationGate pin lifecycle', () => {
  /** A window into the gate: renders its props, exposes its actions. */
  function Probe(gate: GateProps): ReactNode {
    return (
      <>
        <Text>{`center:${gate.center.latitude}`}</Text>
        <Text>{`exploring:${gate.exploring}`}</Text>
        <Text>{`denied:${gate.locationDenied}`}</Text>
        <Pressable testID="pin" onPress={() => gate.onManualCenter(alnwick)} />
        <Pressable testID="release" onPress={() => gate.onBackToNearMe()} />
      </>
    );
  }
  // A fresh element each render — reusing one reference lets React
  // bail out on identical props and the gate would never see new GPS
  const gated = () => <LocationGate>{(gate) => <Probe {...gate} />}</LocationGate>;

  test('a pin takes the center; Back to near me returns it to GPS', async () => {
    gpsLive();
    const screen = await render(gated());
    expect(screen.getByText(`center:${greenwich.latitude}`)).toBeOnTheScreen();
    expect(screen.getByText('exploring:false')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('pin'));
    expect(screen.getByText(`center:${alnwick.latitude}`)).toBeOnTheScreen();
    expect(screen.getByText('exploring:true')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('release'));
    expect(screen.getByText(`center:${greenwich.latitude}`)).toBeOnTheScreen();
    expect(screen.getByText('exploring:false')).toBeOnTheScreen();
  });

  test('a pin dropped blind releases itself when GPS first arrives', async () => {
    gpsDenied();
    const screen = await render(gated());
    expect(screen.getByText('denied:true')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('pin'));
    expect(screen.getByText(`center:${alnwick.latitude}`)).toBeOnTheScreen();
    // Pinned: the gate no longer reads as denied
    expect(screen.getByText('denied:false')).toBeOnTheScreen();

    // Location comes back — the frozen-pin bug fix: GPS wins again
    gpsLive();
    await screen.rerender(gated());
    await waitFor(() =>
      expect(screen.getByText(`center:${greenwich.latitude}`)).toBeOnTheScreen()
    );
    expect(screen.getByText('exploring:false')).toBeOnTheScreen();
  });

  test('a pin dropped deliberately with GPS live holds as the user moves', async () => {
    gpsLive();
    const screen = await render(gated());
    await fireEvent.press(screen.getByTestId('pin'));
    expect(screen.getByText(`center:${alnwick.latitude}`)).toBeOnTheScreen();

    // The user walks — fresh coordinates arrive, the pin does not budge
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.49, longitude: -0.01 },
      requestPermission: jest.fn(),
    });
    await screen.rerender(gated());
    expect(screen.getByText(`center:${alnwick.latitude}`)).toBeOnTheScreen();
    expect(screen.getByText('exploring:true')).toBeOnTheScreen();
  });
});

describe('the Exploring header (StoriesScreen)', () => {
  test('GPS live: NEARBY eyebrow, filled dot, no way-home action', async () => {
    gpsLive();
    const screen = await render(<StoriesScreen />);
    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    expect(screen.queryByText('Back to near me')).toBeNull();
    // No search until the title is tapped
    expect(screen.queryByPlaceholderText('Search near a place…')).toBeNull();
    const dot = screen.getByTestId('locator-dot');
    expect(dot).toHaveStyle({ backgroundColor: '#6A4BDB' });
  });

  test('tapping the title opens search; pinning flips the header to Exploring', async () => {
    gpsLive();
    const screen = await render(<StoriesScreen />);
    await searchFor(screen, 'Alnwick');

    await waitFor(() => expect(screen.getByText('Exploring')).toBeOnTheScreen());
    expect(mockGeocodeAsync).toHaveBeenCalledWith('Alnwick');
    expect(screen.getByText('Alnwick')).toBeOnTheScreen();
    expect(screen.getByText('Back to near me')).toBeOnTheScreen();
    expect(screen.queryByText('Nearby')).toBeNull();
    // The dot hollows out — you are not there
    expect(screen.getByTestId('locator-dot')).toHaveStyle({
      backgroundColor: 'transparent',
      borderWidth: 2,
    });
    // The search folds away once the pin lands
    expect(screen.queryByPlaceholderText('Search near a place…')).toBeNull();
  });

  test('Back to near me clears the pin and the header comes home', async () => {
    gpsLive();
    const screen = await render(<StoriesScreen />);
    await searchFor(screen, 'Alnwick');
    await waitFor(() => expect(screen.getByText('Exploring')).toBeOnTheScreen());

    await fireEvent.press(screen.getByText('Back to near me'));
    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    expect(screen.queryByText('Back to near me')).toBeNull();
    expect(screen.getByTestId('locator-dot')).toHaveStyle({ backgroundColor: '#6A4BDB' });
  });

  test('denied state keeps today’s banner and search, untouched', async () => {
    gpsDenied();
    const screen = await render(<StoriesScreen />);
    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(
      screen.getByText('Location is off — enable it in Settings, or search a place to explore:')
    ).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Search near a place…')).toBeOnTheScreen();
    expect(screen.queryByText('Back to near me')).toBeNull();
  });

  test('a denied-state search pins and reads Exploring, with the way home', async () => {
    gpsDenied();
    const screen = await render(<StoriesScreen />);
    const input = screen.getByPlaceholderText('Search near a place…');
    await fireEvent.changeText(input, 'Alnwick');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => expect(screen.getByText('Exploring')).toBeOnTheScreen());
    expect(screen.getByText('Alnwick')).toBeOnTheScreen();
    expect(screen.getByText('Back to near me')).toBeOnTheScreen();
  });
});

describe('the pin is shared across tabs', () => {
  // Both tabs stay mounted in the real app — render both against the
  // one store. The first cut kept the pin per-gate and these screens
  // disagreed on where the user was (sim-caught); this class of test
  // exists so that can never pass again.
  const bothTabs = () => (
    <>
      <StoriesScreen />
      <HistoryArchiveScreen />
    </>
  );

  test('a pin dropped on Nearby pins History too — same center, both headers', async () => {
    gpsLive();
    const screen = await render(bothTabs());
    // GPS live: only Nearby has a header to search from
    expect(screen.getAllByTestId('area-title')).toHaveLength(1);

    await searchFor(screen, 'Alnwick');

    await waitFor(() => expect(screen.getAllByText('Exploring')).toHaveLength(2));
    expect(screen.getAllByText('Alnwick')).toHaveLength(2); // the SAME pinned center
    expect(screen.getAllByText('Back to near me')).toHaveLength(2);
  });

  test('Back to near me on one tab releases both', async () => {
    gpsLive();
    const screen = await render(bothTabs());
    await searchFor(screen, 'Alnwick');
    await waitFor(() => expect(screen.getAllByText('Back to near me')).toHaveLength(2));

    // Release from the History tab — the far end from where it was set
    await fireEvent.press(screen.getAllByText('Back to near me')[1]);

    expect(screen.queryByText('Exploring')).toBeNull();
    expect(screen.queryByText('Back to near me')).toBeNull();
    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
  });
});

describe('standing-on suppression while exploring', () => {
  // A story right on top of the pinned center — underfoot only if the
  // user were actually there
  const townHall: HistoryItem = {
    pageId: 7,
    title: 'Alnwick Town Hall',
    coordinates: { latitude: alnwick.latitude, longitude: alnwick.longitude },
    distanceMeters: 5,
    thumbnailUrl: 'https://img/hall.jpg',
    url: 'https://x',
    source: 'Wikipedia',
  };

  test('pinned: no "standing on it" — the user is not there', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [townHall] },
      refresh: jest.fn(),
    });
    const screen = await render(<HistoryBody center={alnwick} exploring />);
    expect(screen.queryByText(/standing on it/)).toBeNull();
    expect(screen.getByText('Alnwick Town Hall')).toBeOnTheScreen();
  });

  test('unpinned: the banner leads the screen as ever', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [townHall] },
      refresh: jest.fn(),
    });
    const screen = await render(<HistoryBody center={alnwick} />);
    expect(screen.getByText(/standing on it/)).toBeOnTheScreen();
  });
});

describe('the Exploring header (HistoryArchiveScreen)', () => {
  test('GPS live: no header — the hero is the header', async () => {
    gpsLive();
    const screen = await render(<HistoryArchiveScreen />);
    expect(screen.queryByText('History')).toBeNull();
    expect(screen.getByText('gazetteer body')).toBeOnTheScreen();
  });

  test('denied: the HISTORY header with the search, as today', async () => {
    gpsDenied();
    const screen = await render(<HistoryArchiveScreen />);
    expect(screen.getByText('History')).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Search near a place…')).toBeOnTheScreen();
  });

  test('exploring: the header appears and owns the mode', async () => {
    gpsDenied();
    const screen = await render(<HistoryArchiveScreen />);
    const input = screen.getByPlaceholderText('Search near a place…');
    await fireEvent.changeText(input, 'Alnwick');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => expect(screen.getByText('Exploring')).toBeOnTheScreen());
    expect(screen.queryByText('History')).toBeNull();
    expect(screen.getByText('Back to near me')).toBeOnTheScreen();
    expect(screen.getByText('gazetteer body')).toBeOnTheScreen();
  });
});
