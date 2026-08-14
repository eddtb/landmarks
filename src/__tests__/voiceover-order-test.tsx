/**
 * What VoiceOver hears, and in what order (#296).
 *
 * Four findings from the August accessibility audit, fenced at the
 * rendered tree:
 *
 * 1. The hero's explicit label REPLACED its children on iOS, so the
 *    only place the story's name rendered said "Open the cover photo"
 *    — a blind reader never learned which story they were on.
 * 2. Every screen rendered its chrome AFTER its list "so it paints
 *    above" — but paint order is zIndex's job, and UIKit derives
 *    reading order from subview traversal. On a story screen the back
 *    button was the LAST element, after the whole article.
 * 3. Go's steps sheet put the maneuver list INSIDE a labelled
 *    Pressable, which announced "expanded" and then had nothing to
 *    read.
 * 4. The read tick's ✓ reached the card's accessible name.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';

import GoScreen from '@/app/history/[pageId]/go';
import { AreaGazetteer } from '@/components/area-gazetteer';
import { HistoryCard } from '@/components/history-card';
import { QuizScreen } from '@/components/quiz-screen';
import { StoriesScreen } from '@/components/section-screen';
import { HistoryItem } from '@/types/history';
import { Retold } from '@/types/retold';
import { Coordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

// Real Link (the gazetteer's source row renders through it); only the
// navigation seams GoScreen needs are stood in.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { back: jest.fn(), push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ pageId: '42' }),
}));

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  ...jest.requireActual('@/hooks/use-location'),
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: (center: Coordinates | null) => ({
    name: center === null ? null : 'Greenwich',
    label: center === null ? null : 'Greenwich',
    settled: true,
  }),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: () => mockUseHistory(),
}));

jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: { value: 0 }, available: false }),
}));

const mockCachedItem = jest.fn();
jest.mock('@/data/history-client', () => ({
  getCachedHistoryItem: () => mockCachedItem(),
}));

const mockJournalEntry = jest.fn();
jest.mock('@/data/journal', () => ({
  useJournalEntry: () => mockJournalEntry(),
}));

const mockFetchQuiz = jest.fn();
jest.mock('@/data/quiz-client', () => ({
  fetchQuiz: (...args: unknown[]) => mockFetchQuiz(...args),
  orderedByYear: (items: { year: number }[]) => [...items].sort((a, b) => a.year - b.year),
}));

jest.mock('@/data/quiz-progress', () => ({
  Ranks: ['Stranger', 'Visitor'],
  rankFor: () => 'Stranger',
  recordRun: jest.fn(),
  useAreaProgress: () => undefined,
}));

const article = {
  minutes: 6,
  images: [{ imageUrl: 'https://img/hero.jpg', credit: 'Photo: Test / Geograph (CC BY-SA)' }],
  chapters: [{ title: '', paragraphs: ['The old palace stood here.'] }],
};

const retold: Retold = {
  minutes: 7,
  brief: [],
  timeline: [],
  parts: [
    { heading: 'Part one', body: 'Prose one.' },
    { heading: 'Part two', body: 'Prose two.' },
    { heading: 'Part three', body: 'Prose three.' },
  ],
};

function serveGazetteer() {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes('/api/retold')) {
      return { ok: true, status: 200, json: async () => ({ retold }) };
    }
    if (path.includes('/api/article')) {
      return { ok: true, status: 200, json: async () => ({ article }) };
    }
    if (path.includes('/api/telling')) {
      return { ok: true, status: 200, json: async () => ({ telling: 'A telling.' }) };
    }
    if (path.includes('/api/route')) {
      // A straight line from wherever it was asked to the target — the
      // go-route-asks wire, one route long
      const params = new URL(path).searchParams;
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
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

const story = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  coordinates: greenwich,
  distanceMeters: 400,
  thumbnailUrl: 'https://img/x.jpg',
  extract: `The story of ${title}.`,
  url: `https://en.wikipedia.org/wiki/${title}`,
  source: 'Wikipedia',
});

/** Every testID in the rendered tree, in traversal order — the order
 * UIKit derives VoiceOver's reading order from. */
function idsInOrder(node: unknown, out: string[] = []): string[] {
  if (!node || typeof node === 'string') {
    return out;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      idsInOrder(child, out);
    }
    return out;
  }
  const el = node as { props?: { testID?: string }; children?: unknown[] };
  if (el.props?.testID) {
    out.push(el.props.testID);
  }
  for (const child of el.children ?? []) {
    idsInOrder(child, out);
  }
  return out;
}

/** idsInOrder, asserted: `first` renders before `second`. */
function assertBefore(first: string, second: string) {
  const ids = idsInOrder(screen.toJSON());
  const a = ids.indexOf(first);
  const b = ids.indexOf(second);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(a).toBeLessThan(b);
}

beforeEach(() => {
  jest.clearAllMocks();
  serveGazetteer();
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: greenwich });
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [story(1, 'Cutty Sark')] },
    refresh: jest.fn(),
  });
  mockJournalEntry.mockReturnValue(undefined);
});

// The gazetteer is a VirtualizedList, which schedules its own cell work
// on a timer. Unmount first, then let that timer land, or it fires
// inside the NEXT test's render and collides with its act() scope.
afterEach(async () => {
  cleanup();
  await act(async () => {});
});

describe('1 — the hero label carries the story, not the tap', () => {
  test('VoiceOver hears the name and the meta line; the tap is the hint', async () => {
    await render(
      <AreaGazetteer
        areaName="Cutty Sark"
        relics={[]}
        allStories={[]}
        refreshing={false}
        onRefresh={() => {}}
      />
    );
    await screen.findByTestId('gazetteer-hero');
    await screen.findByText('Prose one.');

    const hero = screen.getByLabelText(
      'The story of Cutty Sark. 3 parts · about 7 min · retold from Wikipedia'
    );
    expect(hero).toHaveProp('accessibilityHint', 'Opens the cover photo');
    // The old label — the tap wearing the name's seat — is gone
    expect(screen.queryByLabelText('Open the cover photo')).not.toBeOnTheScreen();
  });
});

describe('2 — the chrome is announced first', () => {
  test('a story screen reads its back chip before the article', async () => {
    await render(
      <AreaGazetteer
        areaName="Cutty Sark"
        relics={[]}
        allStories={[]}
        refreshing={false}
        onRefresh={() => {}}
        chrome={{ backLabel: 'Stories', onBack: jest.fn() }}
      />
    );
    await screen.findByTestId('gazetteer-hero');

    assertBefore('back-chip', 'gazetteer-list');
  });

  test('Nearby reads its island before the feed', async () => {
    await render(<StoriesScreen />);
    await screen.findByTestId('history-card');

    assertBefore('glass-island', 'history-card');
  });

  test('the quiz reads its island before the run', async () => {
    mockFetchQuiz.mockResolvedValue({
      areaName: 'Greenwich',
      questions: [
        {
          kind: 'anchor',
          pageId: 1,
          title: 'Cutty Sark',
          question: 'What is the Cutty Sark?',
          options: ['A tea clipper', 'A pub', 'A palace', 'A bridge'],
          answerIndex: 0,
          because: 'The last tea clipper.',
        },
      ],
    });
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-start');

    assertBefore('glass-island', 'quiz-start');
  });
});

describe('3 — the steps are readable, not swallowed by their toggle', () => {
  test('each maneuver is its own element outside the labelled Pressable', async () => {
    // 1km due south of the route's destination, so the live step reads
    // a clean kilometre (the go-route-asks geometry)
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.5, longitude: -0.11 },
    });
    mockCachedItem.mockReturnValue({
      ...story(42, 'Winchester Palace'),
      coordinates: { latitude: 51.509, longitude: -0.11 },
    });
    await render(<GoScreen />);
    await screen.findByText('1.0 km to next turn');

    const toggle = screen.getByLabelText(/Steps$/);
    fireEvent.press(toggle);

    // The list is on the screen…
    expect(await screen.findByText(/1\. Walk to the landmark\./)).toBeOnTheScreen();
    // …and NOT inside the labelled toggle, whose explicit label would
    // swallow it on iOS
    expect(within(toggle).queryByText(/1\. Walk to the landmark\./)).not.toBeOnTheScreen();
  });
});

describe('4 — the read tick reads its word, never its glyph', () => {
  test('the tick label is exactly the journal word', async () => {
    mockJournalEntry.mockReturnValue({ readAt: Date.now() });
    await render(<HistoryCard item={story(7, 'Queen’s House')} />);

    const tick = screen.getByTestId('read-tick');
    const label = within(tick).getByLabelText('Read');
    expect(label).toBeOnTheScreen();
    // The ✓ is drawn, not spoken: the label carries no glyph
    expect(label.props.accessibilityLabel).not.toMatch(/✓/);
  });
});
