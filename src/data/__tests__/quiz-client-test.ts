/**
 * The quiz client's one piece of judgement: dealing the options.
 *
 * Every quiz the live route generated had answerIndex 0 on every
 * question — the model puts the right answer first — so the quiz's
 * answer was always A. The client shuffles each question on fetch,
 * remapping answerIndex to follow. What must survive any deal: the
 * right answer is still the right answer.
 */
import { fetchQuiz, resetQuizCacheForTests } from '@/data/quiz-client';
import { Quiz } from '@/types/quiz';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const mockFetch = jest.requireMock('expo/fetch').fetch as jest.Mock;

jest.mock('@/data/api', () => ({ apiUrl: (path: string) => `http://test${path}` }));

const served: Quiz = {
  areaName: 'Greenwich',
  questions: [
    {
      pageId: 1,
      title: 'Cutty Sark',
      question: 'What did she carry?',
      options: ['Tea', 'Coal', 'Gunpowder', 'Ice'],
      answerIndex: 0, // as the model always deals it
      because: 'Built for the China tea trade.',
    },
    {
      pageId: 2,
      title: 'JASON reactor',
      question: 'Until when did it run?',
      options: ['1996', '1969', '2001', '1988'],
      answerIndex: 0,
      because: 'A nuclear reactor ran in Greenwich until 1996.',
    },
  ],
};

const stories = [{ pageId: 1, title: 'Cutty Sark', extract: 'x' }];

beforeEach(() => {
  resetQuizCacheForTests();
  jest.restoreAllMocks();
  // restoreAllMocks un-spies Math.random but does NOT clear a module
  // mock's call count — without this the cache assertion counts other
  // tests' fetches
  mockFetch.mockClear();
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ quiz: served }) });
});

describe('fetchQuiz deals the options', () => {
  test('the right answer survives any deal', async () => {
    const quiz = await fetchQuiz('Greenwich', stories);

    for (const [i, question] of quiz!.questions.entries()) {
      const original = served.questions[i];
      // Same four options, whatever the order
      expect([...question.options].sort()).toEqual([...original.options].sort());
      // …and answerIndex still points at the RIGHT one
      expect(question.options[question.answerIndex]).toBe(
        original.options[original.answerIndex]
      );
    }
  });

  test('an all-A serving stops being all-A', async () => {
    // Force a deal that moves the first option: random draws that
    // reverse the order [0,1,2,3] → [3,2,1,0]
    jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0)
      .mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0);

    const quiz = await fetchQuiz('Greenwich', stories);

    // The served hand was answerIndex 0 everywhere; the dealt one is not
    expect(quiz!.questions.map((question) => question.answerIndex)).not.toEqual([0, 0]);
    // …and the right answers are intact
    expect(quiz!.questions[0].options[quiz!.questions[0].answerIndex]).toBe('Tea');
    expect(quiz!.questions[1].options[quiz!.questions[1].answerIndex]).toBe('1996');
  });

  test('the session cache stores the dealt hand — Go again keeps its order', async () => {
    const first = await fetchQuiz('Greenwich', stories);
    const second = await fetchQuiz('Greenwich', stories);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test('no quiz stays no quiz', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ quiz: null }) });

    expect(await fetchQuiz('Nowhere', stories)).toBeNull();
  });
});
