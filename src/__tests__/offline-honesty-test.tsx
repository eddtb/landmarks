/**
 * Offline honesty beyond the Nearby tab, and the wander line for the AI
 * waits (#248).
 *
 * `state.stale` has been on the hook since the offline feed shipped and
 * exactly one screen read it: Nearby said "you're offline" while the
 * History tab served the same cached stories, from the same hook, in
 * silence. And `DrawingWanderLine` — reduced-motion aware, built for
 * exactly this — was used on one screen while the LONGEST waits in the
 * app got bare grey text.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { HistoryArchiveScreen, StoriesScreen } from '@/components/section-screen';
import { TellingLead } from '@/components/telling-section';
import { HistoryItem } from '@/types/history';
import { RetoldPart } from '@/types/retold';
import { Coordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };

const mockUseLocation = jest.fn(() => ({ status: 'ready', coordinates: greenwich }));
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: (center: Coordinates | null) =>
    center === null
      ? { name: null, label: null, settled: true }
      : { name: 'Greenwich', label: 'Greenwich', settled: true },
}));

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn().mockResolvedValue([]),
}));

const mockUseHistory = jest.fn();
const mockRefresh = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

jest.mock('@/components/one-door', () => ({
  useOneDoorDismissed: () => true,
}));

// The gazetteer's own legs are not what this file is about: nothing
// answers, so the article never paints and the offline line stands
// alone above the relics.
const mockFetch = jest.fn<Promise<unknown>, unknown[]>(async () => {
  throw new TypeError('Network request failed');
});
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const mockFetchTelling = jest.fn();
jest.mock('@/data/telling-client', () => ({
  fetchTelling: (...args: unknown[]) => mockFetchTelling(...args),
}));

// The retelling, driven part by part: the halted state only exists when
// a stream breaks AFTER at least one complete part landed, which no
// fetch-level stub can stage honestly.
const mockFetchRetold = jest.fn();
jest.mock('@/data/retold-client', () => ({
  fetchRetold: (...args: unknown[]) => mockFetchRetold(...args),
}));

const relic: HistoryItem = {
  pageId: 7,
  title: 'Palace of Placentia',
  coordinates: greenwich,
  distanceMeters: 200,
  url: 'https://en.wikipedia.org/wiki/Palace_of_Placentia',
  source: 'Wikipedia',
  pastTag: 'No longer standing',
};

const DayMs = 24 * 60 * 60 * 1000;
const SavedOn = Date.now() - 40 * DayMs;
const SavedDay = new Date(SavedOn).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: greenwich });
  mockFetch.mockImplementation(async () => {
    throw new TypeError('Network request failed');
  });
  // No retelling by default: the area's own article stands as the story
  mockFetchRetold.mockResolvedValue(null);
});

/** The article answers; only the retelling is under test. */
function serveArticle() {
  mockFetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      article: {
        minutes: 4,
        images: [],
        chapters: [{ title: '', paragraphs: ['A palace on the river.'] }],
      },
    }),
  }));
}

function gazetteer() {
  return render(
    <AreaGazetteer
      areaName="Greenwich"
      areaLabel="Greenwich"
      relics={[]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
}

describe('the History tab admits its cache', () => {
  test('a stale feed says so, names the place and names the day', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [relic], stale: true, savedAt: SavedOn },
      refresh: mockRefresh,
    });

    await render(<HistoryArchiveScreen />);

    const line = await screen.findByTestId('offline-saved-copy');
    expect(
      within(line).getByText(`Offline — Greenwich as it was saved on ${SavedDay}.`)
    ).toBeOnTheScreen();
    // Restraint, not an error's shape: no panel and no control
    expect(screen.queryByTestId('load-failed-feed')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('retry-feed')).not.toBeOnTheScreen();
  });

  test('…and a FRESH feed says nothing of the kind', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [relic] },
      refresh: mockRefresh,
    });

    await render(<HistoryArchiveScreen />);

    await screen.findByText('Palace of Placentia');
    expect(screen.queryByTestId('offline-saved-copy')).not.toBeOnTheScreen();
  });

  test('Nearby keeps its own admission — neither tab is silent on the same flag', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [relic], stale: true, savedAt: SavedOn },
      refresh: mockRefresh,
    });

    await render(<StoriesScreen />);

    expect(await screen.findByText("Showing saved stories — you're offline")).toBeOnTheScreen();
  });
});

describe('a feed that could not be reached', () => {
  test.each([
    ['History', HistoryArchiveScreen],
    ['Nearby', StoriesScreen],
  ])('%s names the stories, says what came back, and offers the verb', async (_tab, Screen) => {
    mockUseHistory.mockReturnValue({
      state: { status: 'error', verdict: 'errored' },
      refresh: mockRefresh,
    });

    await render(<Screen />);

    const panel = await screen.findByTestId('load-failed-feed');
    expect(within(panel).getByText('Venture couldn’t reach the stories')).toBeOnTheScreen();
    expect(
      within(panel).getByText(
        'The request went out and the answer was an error. Your saved stories are still on the phone.'
      )
    ).toBeOnTheScreen();
    // "Couldn't load stories right now. Try again" was the same four
    // words on four screens, naming neither the cause nor the cure
    expect(screen.queryByText(/right now/)).not.toBeOnTheScreen();
    expect(screen.queryByText('Try again')).not.toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('retry-feed'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  test('a timeout on the feed says nothing came back, not that an error did', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'error', verdict: 'silent' },
      refresh: mockRefresh,
    });

    await render(<HistoryArchiveScreen />);

    expect(
      await screen.findByText(
        'The request went out and nothing came back. Your saved stories are still on the phone.'
      )
    ).toBeOnTheScreen();
  });
});

describe('the longest waits in the app wear the wander line', () => {
  test('the retelling being written: the line, the place named, and a door out', async () => {
    // The article answers; the retelling never does, so the screen sits
    // in the wait this test is about.
    serveArticle();
    mockFetchRetold.mockReturnValue(new Promise(() => {}));

    await gazetteer();

    const pending = await screen.findByTestId('retelling-pending');
    // The line itself — the purpose-built one, not a spinner
    expect(within(pending).getByTestId('wander-line-drawing', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(within(pending).getByText('Writing the retelling of Greenwich')).toBeOnTheScreen();
    expect(
      within(pending).getByText('It arrives a part at a time, each one appearing as it is written.')
    ).toBeOnTheScreen();
    // A long wait deserves a door out, and the door is a word
    expect(within(pending).getByText('Read the Wikipedia article instead')).toBeOnTheScreen();
    // …and the bare grey sentence it replaced is gone
    expect(screen.queryByText('Retelling this place…')).not.toBeOnTheScreen();
  });

  test('the telling being written says which place, beside the same line', async () => {
    mockFetchTelling.mockReturnValue(new Promise(() => {}));

    await render(<TellingLead item={relic} />);

    const writing = await screen.findByTestId('telling-writing');
    expect(within(writing).getByTestId('wander-line-drawing', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(within(writing).getByText('Writing the telling of Palace of Placentia…')).toBeOnTheScreen();
  });

  test('mid-stream, the wait shrinks to one line under the story it is growing', async () => {
    serveArticle();
    mockFetchRetold.mockImplementation(
      (_name: string, onPart: (part: RetoldPart, index: number) => void) =>
        new Promise<never>(() => {
          onPart({ heading: 'The palace on the river', body: 'Henry was born here.' }, 0);
          onPart({ heading: 'The hospital', body: 'Wren built over it.' }, 1);
        })
    );

    await gazetteer();

    // The part that arrived stays on screen while the next is written
    expect(await screen.findByText('Wren built over it.')).toBeOnTheScreen();
    const pending = await screen.findByTestId('retelling-pending');
    expect(within(pending).getByText('Part three, writing…')).toBeOnTheScreen();
    expect(
      within(pending).getByTestId('wander-line-drawing', { includeHiddenElements: true })
    ).toBeOnTheScreen();
  });

  test('a halted retelling says WHERE it stopped, keeps what arrived, and offers the rest', async () => {
    serveArticle();
    mockFetchRetold.mockImplementation(
      async (_name: string, onPart: (part: RetoldPart, index: number) => void) => {
        onPart({ heading: 'The palace on the river', body: 'Henry was born here.' }, 0);
        onPart({ heading: 'The hospital', body: 'Wren built over it.' }, 1);
        // …and then the stream breaks
        throw new TypeError('Network request failed');
      }
    );

    await gazetteer();

    const halted = await screen.findByTestId('retelling-halted');
    expect(within(halted).getByText('Stopped after part 2')).toBeOnTheScreen();
    expect(
      within(halted).getByText('The connection dropped mid-sentence. What’s written above stays.')
    ).toBeOnTheScreen();
    expect(within(halted).getByText('Write the rest')).toBeOnTheScreen();
    // Whatever arrived, stays
    expect(screen.getByText('Henry was born here.')).toBeOnTheScreen();
    expect(screen.getByText('Wren built over it.')).toBeOnTheScreen();

    // …and the re-ask starts the writing again
    fireEvent.press(screen.getByTestId('retell-retry'));
    await waitFor(() => expect(mockFetchRetold).toHaveBeenCalledTimes(2));
  });
});
