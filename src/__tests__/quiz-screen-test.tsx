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

// The gate is its own tested surface — hand the body a live fix
jest.mock('@/components/section-screen', () => ({
  LocationGate: ({ children }: { children: (props: { center: Coordinates }) => unknown }) =>
    children({ center: { latitude: 51.4826, longitude: -0.0077 } }),
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
