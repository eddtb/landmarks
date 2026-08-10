/**
 * The quiz tab, v1 of the rebuild. Two things matter more than the
 * rest: a tab someone deliberately tapped must NEVER be blank (a quiet
 * corner gets words and a way onward), and the answer must not be
 * visible before you commit to one — a quiz that gives itself away is
 * not a quiz. v1 adds a third: state is words and dimming, never
 * colour, so every verdict here is asserted as TEXT.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { QuizScreen } from '@/components/quiz-screen';
import { Quiz } from '@/types/quiz';
import { Coordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

// The gate is its own tested surface — hand the body a live fix. Mutable
// so a test can put the reader on a pin they are NOT standing at.
// `noFix` hands down a NULL centre, which is what having no location
// means since #289: never the fallback wearing a real place's name.
const mockGate = { exploring: false, noFix: false };
const mockBackToNearMe = jest.fn();
jest.mock('@/components/section-screen', () => ({
  LocationGate: ({ children }: { children: (props: Record<string, unknown>) => unknown }) =>
    children({
      center: mockGate.noFix ? null : { latitude: 51.4826, longitude: -0.0077 },
      standing: mockGate.noFix ? 'refused' : 'located',
      exploring: mockGate.exploring,
      onBackToNearMe: mockBackToNearMe,
    }),
}));

// The magnetometer, which no simulator has: a fixed heading standing in
// for a reader who has turned to face north-east
const mockHeading = { value: 45 };
const mockHeadingAvailable = { current: true };
jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: mockHeading, available: mockHeadingAvailable.current }),
}));

const mockUseAreaName = jest.fn();
jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: () => mockUseAreaName(),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: () => mockUseHistory(),
}));

const mockFetchQuiz = jest.fn();
jest.mock('@/data/quiz-client', () => ({
  fetchQuiz: (...args: unknown[]) => mockFetchQuiz(...args),
  orderedByYear: (items: { year: number }[]) => [...items].sort((a, b) => a.year - b.year),
}));

// The ground's memory is its own tested surface (quiz-progress-test);
// here it only needs to be watchable
const mockRecordRun = jest.fn();
const mockProgress = { value: undefined as { correct: number; runs: number } | undefined };
jest.mock('@/data/quiz-progress', () => ({
  Ranks: ['Stranger', 'Visitor', 'Local', 'Historian'],
  rankFor: (correct: number) => (correct >= 15 ? 'Local' : correct >= 5 ? 'Visitor' : 'Stranger'),
  recordRun: (...args: unknown[]) => mockRecordRun(...args),
  useAreaProgress: () => mockProgress.value,
}));

const story = (pageId: number, title: string) => ({
  pageId,
  title,
  coordinates: greenwich,
  distanceMeters: 100 + pageId,
  extract: `The story of ${title}.`,
  url: `https://en.wikipedia.org/wiki/${title}`,
  source: 'Wikipedia',
});

const quiz: Quiz = {
  areaName: 'Greenwich',
  questions: [
    {
      kind: 'anchor',
      pageId: 1,
      title: 'Cutty Sark',
      question: 'What did the Cutty Sark carry?',
      options: ['Tea', 'Coal', 'Gunpowder', 'Ice'],
      answerIndex: 0,
      because: 'She was built for the China tea trade in 1869.',
    },
    {
      kind: 'which-place',
      pageId: 2,
      title: "Queen's House",
      question: 'Anne of Denmark had a house built to step across a road. Which place?',
      options: ["Queen's House", 'Cutty Sark', 'Trinity Hospital', 'The Fan Museum'],
      answerIndex: 0,
      because: 'The Queen’s House bridged the Deptford–Woolwich road.',
    },
  ],
};

/** Past the start card: the run begins on Begin. */
const begin = async () => {
  fireEvent.press(await screen.findByTestId('quiz-begin'));
  await screen.findByTestId('quiz-run');
};

/** Choose an option and commit to it. State commits a tick after the
 *  press in this harness, so the lock is awaited ENABLED before use. */
const lockIn = async (option: number) => {
  fireEvent.press(await screen.findByTestId(`quiz-option-${option}`));
  await waitFor(() => expect(screen.getByTestId('quiz-lock')).toBeEnabled());
  fireEvent.press(screen.getByTestId('quiz-lock'));
};

/** On to the next question — and past the flip, so the following
 *  queries cannot grab the outgoing screen's elements. */
const next = async () => {
  fireEvent.press(await screen.findByTestId('quiz-next'));
  await waitFor(() => expect(screen.queryByTestId('quiz-next')).toBeNull());
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.exploring = false;
  mockGate.noFix = false;
  mockHeading.value = 45;
  mockHeadingAvailable.current = true;
  mockProgress.value = undefined;
  mockUseAreaName.mockReturnValue({ name: 'Greenwich', label: 'Greenwich', settled: true });
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [story(1, 'Cutty Sark'), story(2, "Queen's House")] },
    refresh: jest.fn(),
  });
  mockFetchQuiz.mockResolvedValue(quiz);
});

describe('<QuizScreen />', () => {
  test('names the ground and opens with the start card, its stories on show', async () => {
    await render(<QuizScreen />);

    expect(await screen.findByTestId('quiz-start')).toBeOnTheScreen();
    expect(screen.getByText('Test yourself on')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    // The grounding contract, worn on the outside: the chips name the
    // exact stories the run was set from
    expect(screen.getByText('Two questions · set from its own stories')).toBeOnTheScreen();
    expect(screen.getByText('Cutty Sark')).toBeOnTheScreen();
    expect(screen.getByText("Queen's House")).toBeOnTheScreen();

    // It asks by the CANONICAL area name, never the display label
    expect(mockFetchQuiz).toHaveBeenCalledWith('Greenwich', [
      { pageId: 1, title: 'Cutty Sark', extract: 'The story of Cutty Sark.' },
      { pageId: 2, title: "Queen's House", extract: "The story of Queen's House." },
    ]);
  });

  test('sends the nearest dozen, not the whole feed', async () => {
    // Deptford answers with 96 stories. Sending all of them made the
    // route refuse the request and the tab show its error state on a
    // real phone — the bug that no amount of route testing found,
    // because the route was tested with a hand-made twelve.
    mockUseHistory.mockReturnValue({
      state: {
        status: 'ready',
        items: Array.from({ length: 96 }, (_, i) => story(i + 1, `Place ${i + 1}`)),
      },
      refresh: jest.fn(),
    });

    await render(<QuizScreen />);
    await screen.findByTestId('quiz-start');

    const sent = mockFetchQuiz.mock.calls[0][1] as unknown[];
    expect(sent).toHaveLength(12);
  });

  test('the screen title stands down while a run is up — one screen, no scroll', async () => {
    // Edd's phone finding: largeTitle + serif question + four options
    // pushed the run into a scroll. During a run the header is the
    // run's own compact eyebrow (area · count · progress).
    await render(<QuizScreen />);
    await begin();

    expect(screen.queryByText('Test yourself on')).toBeNull();
    // The area still names the run, in the compact eyebrow
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
  });

  test('the answer stays hidden until you lock one in', async () => {
    await render(<QuizScreen />);
    await begin();

    expect(screen.getByText('What did the Cutty Sark carry?')).toBeOnTheScreen();
    // Choosing is not committing: still no verdict, no fact given away
    fireEvent.press(screen.getByTestId('quiz-option-0'));
    await waitFor(() => expect(screen.getByTestId('quiz-lock')).toBeEnabled());
    expect(screen.queryByTestId('quiz-verdict-right')).toBeNull();
    expect(screen.queryByText(/China tea trade/)).toBeNull();

    fireEvent.press(screen.getByTestId('quiz-lock'));

    // The verdict is WORDS — the palette rule holds even here
    expect(await screen.findByText('Right — you chose this')).toBeOnTheScreen();
    expect(screen.getByText('She was built for the China tea trade in 1869.')).toBeOnTheScreen();
  });

  test('locking nothing is impossible — the button waits for a choice', async () => {
    await render(<QuizScreen />);
    await begin();

    expect(screen.getByTestId('quiz-lock')).toBeDisabled();
  });

  test('a wrong answer is told so in words, and the fact arrives anyway', async () => {
    await render(<QuizScreen />);
    await begin();

    await lockIn(2);

    expect(await screen.findByText('Your answer')).toBeOnTheScreen();
    expect(screen.getByText('The answer')).toBeOnTheScreen();
    expect(screen.getByText('She was built for the China tea trade in 1869.')).toBeOnTheScreen();
  });

  test('the citation is the invitation: it opens THAT story', async () => {
    await render(<QuizScreen />);
    await begin();
    await lockIn(0);

    fireEvent.press(await screen.findByTestId('quiz-source'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '1' },
    });
  });

  test('through to the score, the run recorded, and round again', async () => {
    await render(<QuizScreen />);
    await begin();

    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    await lockIn(0); // right
    await next();

    expect(await screen.findByText('2 of 2')).toBeOnTheScreen();
    await lockIn(1); // wrong
    await next();

    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    // The ground remembers: one run, one right answer
    expect(mockRecordRun).toHaveBeenCalledWith('Greenwich', 1, 2);
    // Both stories are doors back in, worded by outcome
    expect(screen.getByText('Right')).toBeOnTheScreen();
    expect(screen.getByText('Missed')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('quiz-again'));
    // The question text is unambiguous across the flip; '1 of 2' exists
    // on BOTH screens (score hero and progress) and would race it
    expect(await screen.findByText('What did the Cutty Sark carry?')).toBeOnTheScreen();
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
  });

  test('a perfect run earns the warm banner — yellow’s third sanctioned use', async () => {
    await render(<QuizScreen />);
    await begin();

    await lockIn(0);
    await next();
    await lockIn(0);
    await next();

    expect(await screen.findByTestId('quiz-perfect')).toBeOnTheScreen();
    expect(screen.getByText('A perfect run on this ground.')).toBeOnTheScreen();
  });

  test('an imperfect run does not', async () => {
    await render(<QuizScreen />);
    await begin();

    await lockIn(1);
    await next();
    await lockIn(0);
    await next();

    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
    expect(screen.queryByTestId('quiz-perfect')).toBeNull();
  });

  test('the rank ladder stands on the area’s whole record, not this run', async () => {
    mockProgress.value = { correct: 17, runs: 4 };
    await render(<QuizScreen />);
    await begin();
    await lockIn(1);
    await next();
    await lockIn(1);
    await next();

    expect(await screen.findByTestId('quiz-rank')).toBeOnTheScreen();
    // 17 cumulative right answers: Local, whatever this run scored
    expect(within(screen.getByTestId('quiz-rank-current')).getByText('Local')).toBeOnTheScreen();
  });

  describe('the other kinds', () => {
    test('true-or-myth asks its statement with two doors', async () => {
      mockFetchQuiz.mockResolvedValue({
        areaName: 'Greenwich',
        questions: [
          {
            kind: 'true-false',
            pageId: 5,
            title: 'Greenwich Foot Tunnel',
            statement: 'The Foot Tunnel runs under the Thames.',
            answer: true,
            because: 'Opened 1902, fifteen metres under the river.',
          },
        ],
      });
      await render(<QuizScreen />);
      await begin();

      expect(screen.getByText('The Foot Tunnel runs under the Thames.')).toBeOnTheScreen();
      expect(screen.getByText('True here')).toBeOnTheScreen();
      expect(screen.getByText('A myth')).toBeOnTheScreen();

      await lockIn(0);
      expect(await screen.findByText('Right — you chose this')).toBeOnTheScreen();
      expect(screen.getByText('Opened 1902, fifteen metres under the river.')).toBeOnTheScreen();
    });

    test('order the ground: tapped oldest-first is said Right, in words', async () => {
      mockFetchQuiz.mockResolvedValue({
        areaName: 'Greenwich',
        questions: [
          {
            kind: 'order',
            pageId: 3,
            title: "Queen's House",
            question: 'Oldest first — the order they arrived on this ground.',
            // Dealt: presentation deliberately NOT the answer
            items: [
              { pageId: 4, title: 'Royal Observatory', year: 1675 },
              { pageId: 1, title: 'Cutty Sark', year: 1869 },
              { pageId: 3, title: "Queen's House", year: 1616 },
            ],
            because: 'The Observatory rose on the ruin of a castle the Queen’s House knew.',
          },
        ],
      });
      await render(<QuizScreen />);
      await begin();

      // The years are NOT on the cards before locking — the reasoning is
      // architectural, not memorised
      expect(screen.queryByText('1616')).toBeNull();

      // Oldest first: Queen's House (index 2), Observatory (0), Cutty Sark (1).
      // Each tap is synced on its spoken pick label — the a11y strings
      // double as the harness's commit signal
      fireEvent.press(screen.getByTestId('quiz-order-item-2'));
      await screen.findByLabelText("Queen's House, picked first");
      fireEvent.press(screen.getByTestId('quiz-order-item-0'));
      await screen.findByLabelText('Royal Observatory, picked second');
      fireEvent.press(screen.getByTestId('quiz-order-item-1'));
      await screen.findByLabelText('Cutty Sark, picked third');
      fireEvent.press(screen.getByTestId('quiz-lock'));

      expect(await screen.findByText('Right — oldest first')).toBeOnTheScreen();
      // …and the reveal shows its dates
      expect(screen.getByText('1616')).toBeOnTheScreen();
    });

    test('order the ground: the wrong order is told so, and the years teach', async () => {
      mockFetchQuiz.mockResolvedValue({
        areaName: 'Greenwich',
        questions: [
          {
            kind: 'order',
            pageId: 3,
            title: "Queen's House",
            question: 'Oldest first.',
            items: [
              { pageId: 4, title: 'Royal Observatory', year: 1675 },
              { pageId: 1, title: 'Cutty Sark', year: 1869 },
              { pageId: 3, title: "Queen's House", year: 1616 },
            ],
            because: 'The Observatory rose on the ruin of a castle the Queen’s House knew.',
          },
        ],
      });
      await render(<QuizScreen />);
      await begin();

      // As presented — which is not oldest-first
      fireEvent.press(screen.getByTestId('quiz-order-item-0'));
      await screen.findByLabelText('Royal Observatory, picked first');
      fireEvent.press(screen.getByTestId('quiz-order-item-1'));
      await screen.findByLabelText('Cutty Sark, picked second');
      fireEvent.press(screen.getByTestId('quiz-order-item-2'));
      await screen.findByLabelText("Queen's House, picked third");
      fireEvent.press(screen.getByTestId('quiz-lock'));

      expect(await screen.findByText('Not that order')).toBeOnTheScreen();
      expect(screen.getByText('1675')).toBeOnTheScreen();
    });

    test('a tapped card un-picks itself and everything after it', async () => {
      mockFetchQuiz.mockResolvedValue({
        areaName: 'Greenwich',
        questions: [
          {
            kind: 'order',
            pageId: 3,
            title: "Queen's House",
            question: 'Oldest first.',
            items: [
              { pageId: 4, title: 'Royal Observatory', year: 1675 },
              { pageId: 1, title: 'Cutty Sark', year: 1869 },
              { pageId: 3, title: "Queen's House", year: 1616 },
            ],
            because: 'Because.',
          },
        ],
      });
      await render(<QuizScreen />);
      await begin();

      fireEvent.press(screen.getByTestId('quiz-order-item-2'));
      await screen.findByLabelText("Queen's House, picked first");
      fireEvent.press(screen.getByTestId('quiz-order-item-0'));
      await screen.findByLabelText('Royal Observatory, picked second');
      // Un-pick the first pick: both go, the lock disables again
      fireEvent.press(screen.getByTestId('quiz-order-item-2'));
      await screen.findByLabelText("Queen's House");

      expect(screen.getByTestId('quiz-lock')).toBeDisabled();
    });
  });

  describe('the tab is never blank', () => {
    test('no quiz for this ground: words and a way onward', async () => {
      mockFetchQuiz.mockResolvedValue(null);
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-none')).toBeOnTheScreen();
      expect(screen.getByText(/Not enough recorded history right here/)).toBeOnTheScreen();
      // The area is still named — the screen never loses its heading
      expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    });

    test('nowhere here even has a name: still an answer, not a spinner', async () => {
      mockUseAreaName.mockReturnValue({ name: null, label: null, settled: true });
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-none')).toBeOnTheScreen();
      expect(screen.getByText('this ground')).toBeOnTheScreen();
      // Nothing to key a quiz to, so nothing was spent finding out
      expect(mockFetchQuiz).not.toHaveBeenCalled();
    });

    test('location denied: says what it needs, quizzes NOTHING — never Charing Cross', async () => {
      // The fallback center is central London. Without this state a
      // reviewer in Cupertino who tapped "Not now" was served "Test
      // yourself on Charing Cross" with no explanation.
      mockGate.noFix = true;

      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-denied')).toBeOnTheScreen();
      expect(screen.getByText('wherever you are')).toBeOnTheScreen();
      // The fallback's area label must not surface…
      expect(screen.queryByText('Greenwich')).toBeNull();
      // …and nothing is spent finding out about a place nobody is at
      expect(mockFetchQuiz).not.toHaveBeenCalled();
    });

    test('exploring a pinned place still quizzes it — and the header admits the mode', async () => {
      mockGate.exploring = true;

      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-start')).toBeOnTheScreen();
      expect(mockFetchQuiz).toHaveBeenCalled();
      // The accent eyebrow and the worded way home, as Nearby has
      expect(screen.getByText('Exploring · test yourself on')).toBeOnTheScreen();
      fireEvent.press(screen.getByTestId('quiz-back-to-near-me'));
      expect(mockBackToNearMe).toHaveBeenCalled();
    });

    test('a failure offers Try again, never a blank tab', async () => {
      mockFetchQuiz.mockRejectedValue(new Error('breaker open'));
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-error')).toBeOnTheScreen();
      expect(screen.getByText('Couldn’t set the quiz right now.')).toBeOnTheScreen();

      mockFetchQuiz.mockResolvedValue(quiz);
      fireEvent.press(screen.getByTestId('quiz-retry'));

      expect(await screen.findByTestId('quiz-start')).toBeOnTheScreen();
    });

    test('while the feed and the area are still settling, it says what it is doing', async () => {
      mockUseHistory.mockReturnValue({ state: { status: 'loading' }, refresh: jest.fn() });
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-loading')).toBeOnTheScreen();
      expect(screen.getByText('Setting the questions…')).toBeOnTheScreen();
      expect(mockFetchQuiz).not.toHaveBeenCalled();
    });

    test('an unsettled area name is not yet an answer — it waits, it does not ask', async () => {
      mockUseAreaName.mockReturnValue({ name: null, label: null, settled: false });
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-loading')).toBeOnTheScreen();
      expect(mockFetchQuiz).not.toHaveBeenCalled();
    });
  });
});

/**
 * The pointing question. Alone in the quiz it is derived rather than
 * written, needs no model, and asks the DEVICE something — which is why
 * it closes the run. It cannot be checked on a simulator (no
 * magnetometer), so the heading is mocked here and the arithmetic lives
 * in quiz-direction-test.
 */
describe('the pointing question', () => {
  /** Somewhere far enough away to be worth pointing at: ~400m due north. */
  const northOfHere = {
    pageId: 9,
    title: 'Cutty Sark',
    coordinates: { latitude: 51.4826 + 400 / 111_000, longitude: -0.0077 },
    distanceMeters: 400,
    extract: 'A clipper built for the tea trade.',
    url: 'https://en.wikipedia.org/wiki/Cutty_Sark',
    source: 'Wikipedia',
  };

  const withAPointableStory = () =>
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [story(1, 'Close by'), northOfHere] },
      refresh: jest.fn(),
    });

  const throughTheWrittenQuestions = async () => {
    for (let i = 0; i < quiz.questions.length; i++) {
      await lockIn(0);
      await next();
    }
  };

  test('closes the run, and the count includes it', async () => {
    withAPointableStory();
    await render(<QuizScreen />);
    await begin();

    // Two written questions plus the pointing one
    expect(screen.getByText('1 of 3')).toBeOnTheScreen();

    await throughTheWrittenQuestions();

    expect(await screen.findByTestId('quiz-direction')).toBeOnTheScreen();
    expect(screen.getByText('Which way is Cutty Sark?')).toBeOnTheScreen();
    expect(screen.getByText('3 of 3')).toBeOnTheScreen();
  });

  test('facing it counts, and the fact is given either way', async () => {
    withAPointableStory();
    mockHeading.value = 10; // the story is due north; 10° out, inside 30°
    await render(<QuizScreen />);
    await begin();
    await throughTheWrittenQuestions();

    fireEvent.press(await screen.findByTestId('quiz-direction-lock'));

    expect(await screen.findByTestId('quiz-direction-verdict')).toBeOnTheScreen();
    expect(screen.getByText('Right.')).toBeOnTheScreen();
    expect(screen.getByText(/Cutty Sark is north of here/)).toBeOnTheScreen();
  });

  test('facing the wrong way says how far out, and still says where it is', async () => {
    withAPointableStory();
    mockHeading.value = 180; // due south, 180° out
    await render(<QuizScreen />);
    await begin();
    await throughTheWrittenQuestions();

    fireEvent.press(await screen.findByTestId('quiz-direction-lock'));

    expect(await screen.findByText('Not quite.')).toBeOnTheScreen();
    expect(screen.getByText(/180° out/)).toBeOnTheScreen();
    expect(screen.getByText(/north of here/)).toBeOnTheScreen();
  });

  test('the citation opens THAT story, as the written questions do', async () => {
    withAPointableStory();
    await render(<QuizScreen />);
    await begin();
    await throughTheWrittenQuestions();
    fireEvent.press(await screen.findByTestId('quiz-direction-lock'));

    fireEvent.press(await screen.findByTestId('quiz-direction-source'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '9' },
    });
  });

  test('no compass, no dead end — it says so and the quiz still finishes', async () => {
    withAPointableStory();
    mockHeadingAvailable.current = false;
    await render(<QuizScreen />);
    await begin();
    await throughTheWrittenQuestions();

    expect(await screen.findByTestId('quiz-direction-unavailable')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('quiz-direction-skip'));

    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
  });

  test('not while exploring — pointing from a pin you are not standing at is meaningless', async () => {
    withAPointableStory();
    mockGate.exploring = true;
    await render(<QuizScreen />);
    await begin();

    // Two written questions only
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    await throughTheWrittenQuestions();
    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
    expect(screen.queryByTestId('quiz-direction')).toBeNull();
  });

  test('not with location denied — no quiz at all now, not just no pointing', async () => {
    // Superseded twice over: denied used to run the written questions
    // against the fallback center (Charing Cross). Now the whole tab
    // says what it needs instead.
    withAPointableStory();
    mockGate.noFix = true;
    await render(<QuizScreen />);

    expect(await screen.findByTestId('quiz-denied')).toBeOnTheScreen();
    expect(screen.queryByTestId('quiz-run')).toBeNull();
  });

  test('nothing far enough away, no pointing question', async () => {
    // Every story at the reader's own coordinates
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [story(1, 'Here'), story(2, 'Also here')] },
      refresh: jest.fn(),
    });
    await render(<QuizScreen />);
    await begin();

    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
  });
});

describe('the quiz guard', () => {
  test('a crash in the run becomes words and a retry, never a dead tab', async () => {
    // A quiz shaped to blow up in render: options missing entirely
    mockFetchQuiz.mockResolvedValue({
      areaName: 'Greenwich',
      questions: [{ ...quiz.questions[0], options: undefined }],
    });
    // The boundary logs the error it catches; keep the test output quiet
    jest.spyOn(console, 'error').mockImplementation(() => {});

    await render(<QuizScreen />);
    fireEvent.press(await screen.findByTestId('quiz-begin'));

    expect(await screen.findByTestId('quiz-crashed')).toBeOnTheScreen();
    // The message rides along, so a report from a phone carries a diagnosis
    expect(screen.getByText(/The quiz hit a bug\./)).toBeOnTheScreen();

    // …and the retry re-renders instead of leaving a corpse
    mockFetchQuiz.mockResolvedValue(quiz);
    fireEvent.press(screen.getByTestId('quiz-crash-retry'));
    expect(await screen.findByTestId('quiz-start')).toBeOnTheScreen();
  });
});
