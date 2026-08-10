/**
 * What the two tabs say when Venture does not know where you are
 * (#289, #290 — approved direction A, "Ask again, in the room where it
 * matters").
 *
 * The root of both issues is one line that collapsed two facts:
 * `denied = status === 'denied' || status === 'priming'`. NEVER ASKED
 * and ASKED AND REFUSED have different remedies — iOS will still show
 * its prompt for the first, and shows no Location row in Settings for
 * an app that has never asked — so these fence each state's own answer
 * and, above all, fence the feed: with no honest centre nothing about
 * anybody else's surroundings reaches the screen.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ReactElement } from 'react';

import { PlaceSearchPlaceholder } from '@/components/place-search';
import { QuizScreen } from '@/components/quiz-screen';
import { HistoryArchiveScreen, StoriesScreen } from '@/components/section-screen';
import { Colors } from '@/constants/theme';
import { clearPin } from '@/hooks/use-pin';
import { HistoryItem } from '@/types/history';
import { Coordinates, FallbackCoordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };

const mockUseLocation = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  ...jest.requireActual('@/hooks/use-location'),
  useLocation: () => mockUseLocation(),
  requestLocationPermission: () => mockRequestPermission(),
}));

// A null centre names nothing — the real hook's answer since #289
jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: (center: Coordinates | null) =>
    center === null
      ? { name: null, label: null, settled: true }
      : { name: 'Greenwich', label: 'Greenwich', settled: true },
}));

const mockGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  geocodeAsync: (...args: unknown[]) => mockGeocodeAsync(...args),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

// The root gate owns the door; past it, 'priming' is "Not now"
jest.mock('@/components/one-door', () => ({
  useOneDoorDismissed: () => true,
}));

// The Gazetteer hero is its own tested surface. The stub speaks the
// REAL empty copy as well as its marker, so "the gazetteer never mounts
// with a null centre" can be asserted in the words a reader would see:
// that copy says the records are thin and points at the area title as a
// control, and with no centre both halves are false (#292 × #307).
jest.mock('@/components/area-gazetteer', () => {
  const { Text: RNText } = jest.requireActual('react-native');
  const actual = jest.requireActual('@/components/area-gazetteer');
  return {
    ...actual,
    AreaGazetteer: () => (
      <>
        <RNText>gazetteer body</RNText>
        <RNText>{actual.emptyGazetteerCopy(null)}</RNText>
      </>
    ),
  };
});

// The quiz tab rides the same gate, so it rides the same fences. Its
// own machinery is tested in quiz-screen-test; here it only has to be
// mountable.
const mockFetchQuiz = jest.fn();
jest.mock('@/data/quiz-client', () => ({
  fetchQuiz: (...args: unknown[]) => mockFetchQuiz(...args),
  orderedByYear: (items: { year: number }[]) => [...items].sort((a, b) => a.year - b.year),
}));
jest.mock('@/data/quiz-progress', () => ({
  Ranks: ['Stranger', 'Visitor', 'Local', 'Historian'],
  rankFor: () => 'Stranger',
  recordRun: jest.fn(),
  useAreaProgress: () => undefined,
}));
jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: { value: 0 }, available: false }),
}));

/** Charing Cross, dressed as the reader's surroundings — the story the
 *  fallback centre used to serve to everyone on Earth. */
const trafalgar: HistoryItem = {
  pageId: 5,
  title: 'Trafalgar Square',
  coordinates: FallbackCoordinates,
  distanceMeters: 160,
  thumbnailUrl: 'https://img/x.jpg',
  url: 'https://x',
  source: 'Wikipedia',
};

function neverAsked() {
  mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
}

function refused() {
  mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null });
}

function located() {
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: greenwich });
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPin();
  mockGeocodeAsync.mockResolvedValue([]);
  mockFetchQuiz.mockResolvedValue(null);
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [trafalgar] },
    refresh: jest.fn(),
  });
});

/**
 * Every tab that reads a position. The rule being fenced is not "the
 * Nearby feed behaves" — it is that NO surface may dress a fallback
 * centre as the reader's surroundings. A fourth tab added next month
 * joins this table or fails it.
 */
const locationTabs: { name: string; screen: () => ReactElement }[] = [
  { name: 'Nearby', screen: () => <StoriesScreen /> },
  { name: 'History', screen: () => <HistoryArchiveScreen /> },
  { name: 'Quiz', screen: () => <QuizScreen /> },
];

describe('the feed stands down rather than invent surroundings', () => {
  test('never asked: the invitation leads, and no London story is on the screen', async () => {
    neverAsked();
    const screen = await render(<StoriesScreen />);

    expect(
      await screen.findByText('Venture hasn’t asked where you are yet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('location-invitation')).toBeOnTheScreen();
    expect(screen.queryByText('Trafalgar Square')).toBeNull();
    expect(screen.queryByText(/min walk/)).toBeNull();
  });

  test('never asked: nothing is fetched about a place nobody is at', async () => {
    neverAsked();
    await render(<StoriesScreen />);

    for (const call of mockUseHistory.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  test('refused: the same stand-down, under the Settings sentence', async () => {
    refused();
    const screen = await render(<StoriesScreen />);

    expect(await screen.findByText('Or read a place you name')).toBeOnTheScreen();
    expect(screen.queryByText('Trafalgar Square')).toBeNull();
    expect(
      screen.getByText(
        'Location is off for Venture. Turn it back on in Settings and this fills with the ground you’re standing on.'
      )
    ).toBeOnTheScreen();
  });

  test('located: the feed is the feed again', async () => {
    located();
    const screen = await render(<StoriesScreen />);

    expect(await screen.findByText('Trafalgar Square')).toBeOnTheScreen();
    expect(screen.queryByTestId('location-invitation')).toBeNull();
  });
});

describe('no surface dresses the fallback as your surroundings', () => {
  // The class, not the instance: #289 was only ever noticed on the
  // Nearby feed, but the fallback centre flowed into every tab that
  // reads a position. Each of these renders the whole screen and
  // reads what a user would see.
  for (const tab of locationTabs) {
    for (const state of ['never asked', 'refused'] as const) {
      test(`${tab.name}, ${state}: no London story, no walk time, no borrowed area name`, async () => {
        if (state === 'never asked') {
          neverAsked();
        } else {
          refused();
        }
        const screen = await render(tab.screen());

        // Nothing rendered claims a place the reader is not at
        await waitFor(() => expect(screen.queryByText('Trafalgar Square')).toBeNull());
        expect(screen.queryByText(/min walk/)).toBeNull();
        expect(screen.queryByText(/right here/)).toBeNull();
        expect(screen.queryByText('Greenwich')).toBeNull();
        expect(screen.queryByText(/stories within a walk/)).toBeNull();
      });
    }
  }
});

describe('never asked, refused and locating are three different screens', () => {
  // The regression this whole change exists to prevent: one boolean
  // held two facts, so both got the refused answer. Re-collapse them
  // and these go red — each state is asserted to show its own remedy
  // AND to withhold the other's.
  test('never asked shows the ask and withholds Settings', async () => {
    neverAsked();
    const screen = await render(<StoriesScreen />);

    expect(await screen.findByTestId('ask-for-location')).toBeOnTheScreen();
    expect(screen.getByText('Venture hasn’t asked where you are yet')).toBeOnTheScreen();
    expect(screen.queryByTestId('open-settings')).toBeNull();
    expect(screen.queryByText(/Location is off/)).toBeNull();
  });

  test('refused shows Settings and withholds the ask', async () => {
    refused();
    const screen = await render(<StoriesScreen />);

    expect(await screen.findByTestId('open-settings')).toBeOnTheScreen();
    expect(screen.getByText(/Location is off for Venture/)).toBeOnTheScreen();
    expect(screen.queryByTestId('ask-for-location')).toBeNull();
    expect(screen.queryByText('Venture hasn’t asked where you are yet')).toBeNull();
  });

  test('locating shows neither — a fix is still coming, so nothing is offered yet', async () => {
    mockUseLocation.mockReturnValue({ status: 'locating', coordinates: null });
    const screen = await render(<StoriesScreen />);

    expect(screen.queryByTestId('ask-for-location')).toBeNull();
    expect(screen.queryByTestId('open-settings')).toBeNull();
    expect(screen.queryByTestId('location-invitation')).toBeNull();
    // …and no feed either: the centre is nobody's yet
    expect(screen.queryByText('Trafalgar Square')).toBeNull();
    expect(screen.getByText('Finding places near you…')).toBeOnTheScreen();
  });
});

describe('the locator dot means "you are here"', () => {
  test('no centre: the dot hollows out and the title stops naming London', async () => {
    neverAsked();
    const screen = await render(<StoriesScreen />);

    await screen.findByTestId('location-invitation');
    expect(screen.getByTestId('locator-dot')).toHaveStyle({
      backgroundColor: 'transparent',
      borderWidth: 2,
    });
    expect(screen.getByText('Near you')).toBeOnTheScreen();
    expect(screen.queryByText('Greenwich')).toBeNull();
  });

  test('a real fix: the dot fills, and the area names itself', async () => {
    located();
    const screen = await render(<StoriesScreen />);

    expect(screen.getByTestId('locator-dot')).toHaveStyle({
      backgroundColor: Colors.light.accent,
    });
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
  });

  test('no centre: the title is not a search affordance — the invitation owns that', async () => {
    neverAsked();
    const screen = await render(<StoriesScreen />);

    await screen.findByTestId('location-invitation');
    expect(screen.queryByTestId('area-title')).toBeNull();
  });
});

describe('"Not now" is no longer a one-way door', () => {
  test('never asked: the ask is on the screen and calls iOS directly', async () => {
    neverAsked();
    const screen = await render(<StoriesScreen />);

    await fireEvent.press(await screen.findByTestId('ask-for-location'));
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  test('refused: no ask — iOS will not prompt again — but Settings is offered', async () => {
    refused();
    const screen = await render(<StoriesScreen />);

    await screen.findByTestId('location-invitation');
    expect(screen.queryByTestId('ask-for-location')).toBeNull();
    expect(screen.getByTestId('open-settings')).toBeOnTheScreen();
  });

  test('the Settings control is a control: violet, 44pt, announced as a button', async () => {
    refused();
    const screen = await render(<StoriesScreen />);

    const settings = await screen.findByTestId('open-settings');
    expect(settings).toHaveProp('accessibilityRole', 'button');
    expect(settings).toHaveProp('accessibilityLabel', 'Open Settings');
    expect(settings).toHaveStyle({ minHeight: 44, backgroundColor: Colors.light.accentSoft });
    // Violet words on the lavender chip — interactive means accent
    expect(screen.getByText('Open Settings')).toHaveStyle({ color: Colors.light.accent });
  });
});

describe('the search says what happened', () => {
  test('a place the map does not have: it says so, naming what was typed', async () => {
    refused();
    mockGeocodeAsync.mockResolvedValue([]);
    const screen = await render(<StoriesScreen />);

    const input = await screen.findByPlaceholderText(PlaceSearchPlaceholder);
    await fireEvent.changeText(input, 'Nowhereton');
    await fireEvent(input, 'submitEditing');

    expect(
      await screen.findByText('No map match for “Nowhereton”. Try a postcode, or the nearest town.')
    ).toBeOnTheScreen();
  });

  test('a search that fails outright: it says that too, and what would fix it', async () => {
    refused();
    mockGeocodeAsync.mockRejectedValue(new Error('offline'));
    const screen = await render(<StoriesScreen />);

    const input = await screen.findByPlaceholderText(PlaceSearchPlaceholder);
    await fireEvent.changeText(input, 'Alnwick');
    await fireEvent(input, 'submitEditing');

    expect(
      await screen.findByText('Couldn’t search just now. Check your connection and try again.')
    ).toBeOnTheScreen();
  });

  test('a place that is found clears the message and pins it', async () => {
    refused();
    mockGeocodeAsync.mockResolvedValueOnce([]);
    const screen = await render(<StoriesScreen />);

    const input = await screen.findByPlaceholderText(PlaceSearchPlaceholder);
    await fireEvent.changeText(input, 'Nowhereton');
    await fireEvent(input, 'submitEditing');
    await screen.findByText(/No map match/);

    mockGeocodeAsync.mockResolvedValue([{ latitude: 55.4135, longitude: -1.7055 }]);
    await fireEvent.changeText(input, 'Alnwick');
    await fireEvent(input, 'submitEditing');

    await waitFor(() => expect(screen.getByText('Exploring')).toBeOnTheScreen());
    expect(screen.queryByText(/No map match/)).toBeNull();
  });
});

describe('the Gazetteer is written about a place', () => {
  test('never asked: the History tab asks, and retells nothing', async () => {
    neverAsked();
    const screen = await render(<HistoryArchiveScreen />);

    expect(
      await screen.findByText('Venture hasn’t asked where you are yet')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('ask-for-location')).toBeOnTheScreen();
    expect(screen.queryByText('gazetteer body')).toBeNull();
    for (const call of mockUseHistory.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  test('refused: its own sentence, and Settings rather than the ask', async () => {
    refused();
    const screen = await render(<HistoryArchiveScreen />);

    expect(
      await screen.findByText(
        'Location is off for Venture. Turn it on in Settings to read the ground you’re standing on.'
      )
    ).toBeOnTheScreen();
    expect(screen.getByText('The Gazetteer is written about a place')).toBeOnTheScreen();
    expect(screen.queryByTestId('ask-for-location')).toBeNull();
  });

  /**
   * Where #292 meets #289. The Gazetteer's empty copy — "Nothing is
   * written down within a walk… tap the name above to look somewhere
   * else" — became reachable in #292, and both of its halves are FALSE
   * with no centre: the records are not thin, we simply have not asked
   * where the reader is; and the title above is a name rather than a
   * control in that state, so it points at nothing.
   *
   * It is kept off this screen structurally — GazetteerBody answers the
   * invitation before the Gazetteer is ever mounted — and both facts
   * are asserted together here so that moving one cannot quietly
   * unpick the other.
   */
  test.each([
    { what: 'never asked', arrange: neverAsked },
    { what: 'refused', arrange: refused },
  ])('$what: no thin-records claim, and no control for it to point at', async ({ arrange }) => {
    arrange();
    const screen = await render(<HistoryArchiveScreen />);

    // The header stands and keeps the tab's identity (#292)…
    expect(await screen.findByText('History')).toBeOnTheScreen();
    // …but the thin-records claim is never made, because the Gazetteer
    // that would make it never mounts
    expect(screen.queryByText(/^Nothing is written down within a walk/)).toBeNull();
    expect(screen.queryByText('gazetteer body')).toBeNull();
    // …and the name above is not a control, which is what that copy
    // would have been pointing at
    expect(screen.queryByTestId('area-title')).toBeNull();
    expect(screen.getByText('Near you')).toBeOnTheScreen();
  });
});
