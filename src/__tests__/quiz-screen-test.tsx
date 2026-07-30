/**
 * The quiz tab. Two things matter more than the rest: a tab someone
 * deliberately tapped must NEVER be blank (a quiet corner gets words and
 * a way onward), and the answer must not be visible before you commit to
 * one — a quiz that gives itself away is not a quiz.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

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
const mockGate = { exploring: false, locationDenied: false };
jest.mock('@/components/section-screen', () => ({
  LocationGate: ({ children }: { children: (props: Record<string, unknown>) => unknown }) =>
    children({
      center: { latitude: 51.4826, longitude: -0.0077 },
      exploring: mockGate.exploring,
      locationDenied: mockGate.locationDenied,
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
      pageId: 1,
      title: 'Cutty Sark',
      question: 'What did the Cutty Sark carry?',
      options: ['Tea', 'Coal', 'Gunpowder', 'Ice'],
      answerIndex: 0,
      because: 'She was built for the China tea trade in 1869.',
    },
    {
      pageId: 2,
      title: "Queen's House",
      question: 'Who was the House built for?',
      options: ['Anne of Denmark', 'Elizabeth I', 'Mary II', 'Victoria'],
      answerIndex: 0,
      because: 'James I commissioned it for his wife Anne of Denmark.',
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.exploring = false;
  mockGate.locationDenied = false;
  mockHeading.value = 45;
  mockHeadingAvailable.current = true;
  mockUseAreaName.mockReturnValue({ name: 'Greenwich', label: 'Greenwich', settled: true });
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [story(1, 'Cutty Sark'), story(2, "Queen's House")] },
    refresh: jest.fn(),
  });
  mockFetchQuiz.mockResolvedValue(quiz);
});

describe('<QuizScreen />', () => {
  test('names the ground and asks the first question', async () => {
    await render(<QuizScreen />);

    expect(await screen.findByTestId('quiz-run')).toBeOnTheScreen();
    expect(screen.getByText('Test yourself on')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
    expect(screen.getByText('Question 1 of 2')).toBeOnTheScreen();
    expect(screen.getByText('What did the Cutty Sark carry?')).toBeOnTheScreen();

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
    await screen.findByTestId('quiz-run');

    const sent = mockFetchQuiz.mock.calls[0][1] as unknown[];
    expect(sent).toHaveLength(12);
  });

  test('the answer stays hidden until you commit to one', async () => {
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    // Nothing on screen says which is right, and no fact is given away
    expect(screen.queryByTestId('quiz-because')).toBeNull();
    expect(screen.queryByText(/China tea trade/)).toBeNull();

    fireEvent.press(screen.getByTestId('quiz-option-0'));

    expect(await screen.findByTestId('quiz-because')).toBeOnTheScreen();
    expect(screen.getByText('Right.')).toBeOnTheScreen();
    expect(screen.getByText('She was built for the China tea trade in 1869.')).toBeOnTheScreen();
  });

  test('a wrong answer is told so, and still gives the fact', async () => {
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    fireEvent.press(screen.getByTestId('quiz-option-2'));

    expect(await screen.findByText('Not this time.')).toBeOnTheScreen();
    expect(screen.getByText('She was built for the China tea trade in 1869.')).toBeOnTheScreen();
  });

  test('the citation is the invitation: it opens THAT story', async () => {
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');
    fireEvent.press(screen.getByTestId('quiz-option-0'));

    fireEvent.press(await screen.findByTestId('quiz-source'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '1' },
    });
  });

  test('through to the score, and round again', async () => {
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    fireEvent.press(screen.getByTestId('quiz-option-0')); // right
    fireEvent.press(await screen.findByTestId('quiz-next'));

    expect(await screen.findByText('Question 2 of 2')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('quiz-option-1')); // wrong
    fireEvent.press(await screen.findByTestId('quiz-next'));

    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
    expect(screen.getByText('1 out of 2')).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId('quiz-again'));
    expect(await screen.findByText('Question 1 of 2')).toBeOnTheScreen();
  });

  test('a full score says so', async () => {
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    fireEvent.press(screen.getByTestId('quiz-option-0'));
    fireEvent.press(await screen.findByTestId('quiz-next'));
    fireEvent.press(await screen.findByTestId('quiz-option-0'));
    fireEvent.press(await screen.findByTestId('quiz-next'));

    expect(await screen.findByText('2 out of 2')).toBeOnTheScreen();
    expect(screen.getByText('Every one. You know this ground.')).toBeOnTheScreen();
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

    test('a failure offers Try again, never a blank tab', async () => {
      mockFetchQuiz.mockRejectedValue(new Error('breaker open'));
      await render(<QuizScreen />);

      expect(await screen.findByTestId('quiz-error')).toBeOnTheScreen();
      expect(screen.getByText('Couldn’t set the quiz right now.')).toBeOnTheScreen();

      mockFetchQuiz.mockResolvedValue(quiz);
      fireEvent.press(screen.getByTestId('quiz-retry'));

      expect(await screen.findByTestId('quiz-run')).toBeOnTheScreen();
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
      fireEvent.press(await screen.findByTestId('quiz-option-0'));
      fireEvent.press(await screen.findByTestId('quiz-next'));
    }
  };

  test('closes the run, and the count includes it', async () => {
    withAPointableStory();
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    // Two written questions plus the pointing one
    expect(screen.getByText('Question 1 of 3')).toBeOnTheScreen();

    await throughTheWrittenQuestions();

    expect(await screen.findByTestId('quiz-direction')).toBeOnTheScreen();
    expect(screen.getByText('Which way is Cutty Sark?')).toBeOnTheScreen();
    expect(screen.getByText('Question 3 of 3')).toBeOnTheScreen();
  });

  test('facing it counts, and the fact is given either way', async () => {
    withAPointableStory();
    mockHeading.value = 10; // the story is due north; 10° out, inside 30°
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');
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
    await screen.findByTestId('quiz-run');
    await throughTheWrittenQuestions();

    fireEvent.press(await screen.findByTestId('quiz-direction-lock'));

    expect(await screen.findByText('Not quite.')).toBeOnTheScreen();
    expect(screen.getByText(/180° out/)).toBeOnTheScreen();
    expect(screen.getByText(/north of here/)).toBeOnTheScreen();
  });

  test('the citation opens THAT story, as the written questions do', async () => {
    withAPointableStory();
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');
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
    await screen.findByTestId('quiz-run');
    await throughTheWrittenQuestions();

    expect(await screen.findByTestId('quiz-direction-unavailable')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('quiz-direction-skip'));

    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
  });

  test('not while exploring — pointing from a pin you are not standing at is meaningless', async () => {
    withAPointableStory();
    mockGate.exploring = true;
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    // Two written questions only
    expect(screen.getByText('Question 1 of 2')).toBeOnTheScreen();
    await throughTheWrittenQuestions();
    expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
    expect(screen.queryByTestId('quiz-direction')).toBeNull();
  });

  test('not with location denied — the center is the fallback, not the reader', async () => {
    withAPointableStory();
    mockGate.locationDenied = true;
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    expect(screen.getByText('Question 1 of 2')).toBeOnTheScreen();
  });

  test('nothing far enough away, no pointing question', async () => {
    // Every story at the reader's own coordinates
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [story(1, 'Here'), story(2, 'Also here')] },
      refresh: jest.fn(),
    });
    await render(<QuizScreen />);
    await screen.findByTestId('quiz-run');

    expect(screen.getByText('Question 1 of 2')).toBeOnTheScreen();
  });
});
