/**
 * Failure and absence are different verdicts (#291).
 *
 * Both article legs used to end in `.catch(() => null)`, so a 502, a
 * timeout and a genuine 404 arrived as one `null`, set
 * `articleStatus = 'none'`, and printed "No recorded story for this
 * area yet" — a claim about the historical record, made because a
 * worker was recycling. A single test could not have caught it either:
 * all four causes produced one sentence.
 *
 * So the four causes get four tests, at the wire, asserting what a
 * READER sees — and a fifth test that goes red the moment any two of
 * them are answered alike again. That last one is the fence; the other
 * four say which verdict each cause earns.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import {
  failureCopy,
  FailureCause,
  FailureCauses,
  FailureSurface,
  FailureSurfaces,
  LoadFailure,
} from '@/components/load-failure';
import { Colors } from '@/constants/theme';
import { HistoryItem } from '@/types/history';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const mockScheme = jest.fn(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockScheme(),
}));

const stone: HistoryItem = {
  pageId: 9,
  title: 'Ightham Mote',
  coordinates: { latitude: 51.2846, longitude: 0.2846 },
  distanceMeters: 1300,
  url: 'https://en.wikipedia.org/wiki/Ightham_Mote',
  source: 'Historic England',
};

/**
 * One cause, at the wire. The real `fetchArticle`/`fetchArticleLight`
 * run against these answers, so the ApiError (or the bare rejection)
 * the screen classifies is the genuine article — not a stubbed verdict.
 */
type Cause = '404' | '500' | 'timeout';

const Wire: Record<Cause, () => Promise<unknown>> = {
  // The record's own answer: there is no article for this place.
  '404': async () => ({ ok: false, status: 404 }),
  // A worker recycling. An answer came back and it was an error.
  '500': async () => ({ ok: false, status: 500 }),
  // The request never completed — no status was ever reached.
  timeout: async () => {
    throw new TypeError('Network request timed out');
  },
};

function serve(cause: Cause) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    // This file is about the ARTICLE legs; the retelling abstains.
    if (path.includes('/api/retold')) {
      return { ok: false, status: 404 };
    }
    if (path.includes('/api/article')) {
      return Wire[cause]();
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

const DayMs = 24 * 60 * 60 * 1000;
/** Far enough back that the line names a DATE ("8 August") rather than
 * a weekday — the mock's own sentence. */
const SavedOn = Date.now() - 40 * DayMs;
const SavedDay = new Date(SavedOn).toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
});

async function paint(cause: Cause, offline = false, savedAt = SavedOn) {
  serve(cause);
  return render(
    <AreaGazetteer
      areaName="Ightham, Kent"
      areaLabel="Ightham"
      relics={[stone]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
      stale={offline || undefined}
      savedAt={offline ? savedAt : undefined}
    />
  );
}

/** The three grammars, each with its own testID — which is the point:
 * a reader can tell them apart before reading a word. */
const AnyVerdict = /gazetteer-absent|load-failed-area-article|offline-saved-copy/;

/** Every sentence inside whichever grammar answered. */
function sentencesIn(block: ReturnType<typeof screen.getByTestId>): string[] {
  return within(block)
    .queryAllByText(/\S/)
    .map((node) => String(node.props.children));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScheme.mockReturnValue('light');
});

describe('the four causes of a missing article', () => {
  test('404 from both legs — the RECORD is empty, and it says so without a retry', async () => {
    await paint('404');

    const block = await screen.findByTestId('gazetteer-absent');
    expect(within(block).getByText('No record')).toBeOnTheScreen();
    expect(within(block).getByText('Wikipedia has no article for Ightham')).toBeOnTheScreen();
    expect(
      within(block).getByText('One relic stands on this ground anyway. It’s below.')
    ).toBeOnTheScreen();
    // …and the relic it promised is there
    expect(screen.getByText('Ightham Mote')).toBeOnTheScreen();

    // Absence keeps a DIFFERENT GRAMMAR on purpose: no panel, and no
    // button to press against an answer that will not change. This is
    // the structural half of the fix — if a reader cannot tell the two
    // states apart at a glance, #291 is still open.
    expect(screen.queryByTestId('load-failed-area-article')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('retry-area-article')).not.toBeOnTheScreen();
    expect(screen.queryByText('Ask again')).not.toBeOnTheScreen();
  });

  test('500 from both legs — VENTURE failed, and the record is left alone', async () => {
    await paint('500');

    const block = await screen.findByTestId('load-failed-area-article');
    expect(within(block).getByText('No answer')).toBeOnTheScreen();
    expect(within(block).getByText('Wikipedia didn’t answer')).toBeOnTheScreen();
    expect(
      within(block).getByText(
        'Venture asked twice and the answer was an error. Nothing is missing from the record — only from this screen.'
      )
    ).toBeOnTheScreen();
    expect(within(block).getByText('Ask again')).toBeOnTheScreen();

    // The sentence that used to print here, and the whole of the bug
    expect(screen.queryByText(/Wikipedia has no article/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/No recorded story/)).not.toBeOnTheScreen();
    expect(screen.queryByTestId('gazetteer-absent')).not.toBeOnTheScreen();
  });

  test('a timeout — nothing came back, and that is not the same as an error coming back', async () => {
    await paint('timeout');

    const block = await screen.findByTestId('load-failed-area-article');
    expect(within(block).getByText('Wikipedia didn’t answer')).toBeOnTheScreen();
    expect(
      within(block).getByText(
        'Venture asked twice and nothing came back. Nothing is missing from the record — only from this screen.'
      )
    ).toBeOnTheScreen();
    // Not the 5xx sentence, and never the record's
    expect(screen.queryByText(/the answer was an error/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/Wikipedia has no article/)).not.toBeOnTheScreen();
  });

  test('offline — the phone is the fact, so no panel, no retry, and no claim about history', async () => {
    await paint('timeout', true);

    const block = await screen.findByTestId('offline-saved-copy');
    // The place is named, and so is the day the copy was written — an
    // hour-old snapshot and a month-old one are different things to be
    // reading
    expect(
      within(block).getByText(`Offline — Ightham as it was saved on ${SavedDay}.`)
    ).toBeOnTheScreen();
    expect(SavedDay).toMatch(/^\d{1,2} [A-Z][a-z]+$/);

    // Offline is not an error and must not wear an error's shape
    expect(screen.queryByTestId('load-failed-area-article')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('retry-area-article')).not.toBeOnTheScreen();
    // …nor may it describe a record it never reached
    expect(screen.queryByTestId('gazetteer-absent')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Wikipedia has no article/)).not.toBeOnTheScreen();

    // …and yesterday's copy says "yesterday", not "on yesterday"
    await cleanup();
    await paint('timeout', true, Date.now() - DayMs);
    expect(
      await screen.findByText('Offline — Ightham as it was saved yesterday.')
    ).toBeOnTheScreen();
  });

  /**
   * The fence. Whatever the four say, they must not say the same thing
   * — which is exactly what one `.catch(() => null)` made them do, to
   * the reader and to the suite alike.
   */
  test('the four causes give four different answers, and nothing may collapse two of them again', async () => {
    const answers: string[] = [];
    for (const [cause, offline] of [
      ['404', false],
      ['500', false],
      ['timeout', false],
      ['timeout', true],
    ] as const) {
      await paint(cause, offline);
      const block = await screen.findByTestId(AnyVerdict);
      answers.push(
        JSON.stringify({
          // The shape a reader sees before reading: panel, statement, margin line
          grammar: block.props.testID,
          words: sentencesIn(block),
          // A retry offered against a 404 teaches a tap that does nothing
          retry: screen.queryByTestId('retry-area-article') !== null,
        })
      );
      await cleanup();
    }

    expect(new Set(answers).size).toBe(answers.length);
  });

  test('a retry after a 500 asks again, and the article that answers replaces the panel', async () => {
    await paint('500');
    await screen.findByTestId('load-failed-area-article');

    mockFetch.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/retold')) {
        return { ok: false, status: 404 };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          article: {
            minutes: 4,
            images: [],
            chapters: [{ title: '', paragraphs: ['A village below the Downs.'] }],
          },
        }),
      };
    });
    fireEvent.press(screen.getByTestId('retry-area-article'));

    expect(await screen.findByTestId('gazetteer-hero')).toBeOnTheScreen();
    expect(screen.queryByTestId('load-failed-area-article')).not.toBeOnTheScreen();
  });
});

/**
 * The class, not the instance. Every surface that reports a load
 * failure walks this suite off `FailureSurfaces`, so a fifth one joins
 * the fence by existing — it cannot quietly say the wrong thing.
 */
describe('every surface that reports a load failure', () => {
  /** Placeholders that shipped, and the words that stand in for a cause. */
  const BannedActions = ['Try again', 'Retry', 'OK', 'Reload', 'Dismiss'];
  const BannedPhrases = [/right now/i, /just now/i, /something went wrong/i, /oops/i];

  test.each(
    FailureSurfaces.flatMap((surface) =>
      FailureCauses.map((cause) => [surface, cause] as [FailureSurface, FailureCause])
    )
  )('%s · %s says what broke, what came back, and the verb that fixes it', async (surface, cause) => {
    await render(<LoadFailure surface={surface} cause={cause} onRetry={() => {}} />);
    const block = screen.getByTestId(`load-failed-${surface}`);
    const copy = failureCopy(surface, cause);

    // The eyebrow every failure wears, and only failure
    expect(within(block).getByText('No answer')).toBeOnTheScreen();
    expect(within(block).getByText(copy.headline)).toBeOnTheScreen();
    expect(within(block).getByText(copy.body)).toBeOnTheScreen();

    for (const words of [copy.headline, copy.body, copy.action]) {
      for (const banned of BannedPhrases) {
        expect(words).not.toMatch(banned);
      }
    }
    // The retry word is the verb of the thing. "Try again" went out to
    // four screens as a placeholder and stayed.
    expect(BannedActions).not.toContain(copy.action);
    // …and it names something, rather than gesturing at it
    expect(copy.headline.length).toBeGreaterThan(12);
  });

  test.each(FailureSurfaces)('%s says what came back, so 5xx and a timeout differ', (surface) => {
    expect(failureCopy(surface, 'silent').body).not.toBe(failureCopy(surface, 'errored').body);
  });

  test.each(FailureSurfaces)('%s: the control is a word, 44pt, and calls back', async (surface) => {
    const onRetry = jest.fn();
    await render(<LoadFailure surface={surface} cause="silent" onRetry={onRetry} />);

    const action = screen.getByTestId(`retry-${surface}`);
    expect(action).toHaveStyle({ height: 44 });
    fireEvent.press(action);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test.each(FailureSurfaces)(
    '%s: the label on the accent takes theme.background — white is 2.79:1 there',
    async (surface) => {
      mockScheme.mockReturnValue('dark');
      await render(<LoadFailure surface={surface} cause="silent" onRetry={() => {}} />);

      const label = screen.getByText(failureCopy(surface, 'silent').action);
      expect(label).toHaveStyle({ color: Colors.dark.background });
      expect(label).not.toHaveStyle({ color: '#FFFFFF' });
      expect(screen.getByTestId(`retry-${surface}`)).toHaveStyle({
        backgroundColor: Colors.dark.accent,
      });
    }
  );

  test('no colour carries state anywhere on the panel — the semantic tokens stay deleted', async () => {
    const palette = new Set<string>([
      ...Object.values(Colors.light),
      ...Object.values(Colors.dark),
      '#FFFFFF',
    ]);
    for (const surface of FailureSurfaces) {
      await render(<LoadFailure surface={surface} cause="errored" onRetry={() => {}} />);
      const flattened = JSON.stringify(screen.toJSON());
      for (const hex of flattened.match(/#[0-9a-fA-F]{6}/g) ?? []) {
        expect(palette).toContain(hex.toUpperCase() === hex ? hex : hex.toUpperCase());
      }
      await cleanup();
    }
  });
});
