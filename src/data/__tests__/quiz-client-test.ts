/**
 * The quiz client's one piece of judgement: dealing the hand.
 *
 * Every quiz the live route generated had answerIndex 0 on every
 * question — the model puts the right answer first — so the quiz's
 * answer was always A. The client shuffles each question on fetch,
 * remapping answerIndex to follow. v2 makes the pattern load-bearing:
 * which-place arrives right-answer-first by construction, and order
 * arrives oldest-first because that IS the answer. What must survive
 * any deal: the right answer is still the right answer.
 */
import { fetchQuiz, orderedByYear, resetQuizCacheForTests } from '@/data/quiz-client';
import { AnchorQuestion, OrderQuestion, Quiz, WhichPlaceQuestion, quizCacheKey } from '@/types/quiz';

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const mockFetch = jest.requireMock('expo/fetch').fetch as jest.Mock;

jest.mock('@/data/api', () => ({ apiUrl: (path: string) => `http://test${path}` }));

const served: Quiz = {
  areaName: 'Greenwich',
  questions: [
    {
      kind: 'anchor',
      pageId: 1,
      title: 'Cutty Sark',
      question: 'What did she carry?',
      options: ['Tea', 'Coal', 'Gunpowder', 'Ice'],
      answerIndex: 0, // as the model always deals it
      because: 'Built for the China tea trade.',
    },
    {
      kind: 'which-place',
      pageId: 2,
      title: 'JASON reactor',
      question: 'A nuclear reactor ran here until 1996. Which place?',
      options: ['JASON reactor', 'Cutty Sark', 'Queen’s House', 'Trinity Hospital'],
      answerIndex: 0, // ALWAYS, by construction — the server puts ours first
      because: 'Inside the Royal Naval College, until 1996.',
    },
    {
      kind: 'order',
      pageId: 3,
      title: 'Queen’s House',
      question: 'Oldest first.',
      items: [
        { pageId: 3, title: 'Queen’s House', year: 1616 },
        { pageId: 4, title: 'Royal Observatory', year: 1675 },
        { pageId: 1, title: 'Cutty Sark', year: 1869 },
      ],
      because: 'The Observatory was built on the ruin of a castle the Queen’s House knew.',
    },
    {
      kind: 'true-false',
      pageId: 5,
      title: 'Greenwich Foot Tunnel',
      statement: 'The Foot Tunnel runs under the Thames.',
      answer: true,
      because: 'Opened 1902, fifteen metres under the river.',
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

describe('fetchQuiz deals the hand', () => {
  test('the right answer survives any deal, for both option kinds', async () => {
    const quiz = await fetchQuiz('Greenwich', stories);

    for (const [i, question] of quiz!.questions.entries()) {
      const original = served.questions[i];
      if (question.kind !== 'anchor' && question.kind !== 'which-place') {
        continue;
      }
      const dealtFrom = original as AnchorQuestion | WhichPlaceQuestion;
      // Same four options, whatever the order
      expect([...question.options].sort()).toEqual([...dealtFrom.options].sort());
      // …and answerIndex still points at the RIGHT one
      expect(question.options[question.answerIndex]).toBe(
        dealtFrom.options[dealtFrom.answerIndex]
      );
    }
  });

  test('an all-A serving stops being all-A', async () => {
    // Force a deal that moves the first option: random draws that
    // reverse the order [0,1,2,3] → [3,2,1,0]
    jest
      .spyOn(Math, 'random')
      .mockReturnValue(0);

    const quiz = await fetchQuiz('Greenwich', stories);
    const optioned = quiz!.questions.filter(
      (question): question is AnchorQuestion | WhichPlaceQuestion =>
        question.kind === 'anchor' || question.kind === 'which-place'
    );

    // The served hand was answerIndex 0 everywhere; the dealt one is not
    expect(optioned.map((question) => question.answerIndex)).not.toEqual([0, 0]);
    // …and the right answers are intact
    expect(optioned[0].options[optioned[0].answerIndex]).toBe('Tea');
    expect(optioned[1].options[optioned[1].answerIndex]).toBe('JASON reactor');
  });

  test('an order question never arrives pre-solved', async () => {
    // Whatever the dealing, presenting the wire's own order would be a
    // question answered by doing nothing. Run the deal many times: the
    // presentation must never equal the answer.
    for (let round = 0; round < 25; round++) {
      resetQuizCacheForTests();
      const quiz = await fetchQuiz('Greenwich', stories);
      const dealt = quiz!.questions.find(
        (question): question is OrderQuestion => question.kind === 'order'
      )!;

      const answer = orderedByYear(dealt.items);
      expect(dealt.items.map((item) => item.pageId)).not.toEqual(
        answer.map((item) => item.pageId)
      );
      // The answer itself is intact and recoverable
      expect(answer.map((item) => item.year)).toEqual([1616, 1675, 1869]);
    }
  });

  test('the session cache stores the dealt hand — Go again keeps its order', async () => {
    const first = await fetchQuiz('Greenwich', stories);
    const second = await fetchQuiz('Greenwich', stories);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  test('walking across the area — reordered, then re-membered — stays one ask', async () => {
    // The feed is distance-sorted from the reader's ~111m bucket, so a
    // walk both re-orders it AND changes which stories are nearest.
    // Keyed on that, a 2km stroll with the tab open went back to the
    // route ~18 times for a quiz it already held (#280).
    const nearest = [
      { pageId: 1, title: 'Cutty Sark', extract: 'x' },
      { pageId: 2, title: 'Queen’s House', extract: 'y' },
      { pageId: 3, title: 'Royal Observatory', extract: 'z' },
    ];

    await fetchQuiz('Greenwich', nearest);
    // A hundred paces: the same three, re-sorted by distance
    await fetchQuiz('Greenwich', [nearest[2], nearest[0], nearest[1]]);
    // A hundred more: one dropped off the back, a new one came in front
    await fetchQuiz('Greenwich', [
      { pageId: 4, title: 'Greenwich Foot Tunnel', extract: 'w' },
      nearest[0],
      nearest[1],
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('the client keys on exactly what the server keys on', async () => {
    // ONE function, both sides of the wire. They disagreed before — this
    // side digested pageIds, that side digested pageId + title + extract
    // — so the session cache could hit where the route would have
    // regenerated, and the device served a quiz the store did not have.
    const other = [{ pageId: 9, title: 'Somewhere else', extract: 'q' }];

    await fetchQuiz('Greenwich', stories);
    // Same key by the shared function: same area, any material, any case
    expect(quizCacheKey('greenwich')).toBe(quizCacheKey('Greenwich'));
    await fetchQuiz('greenwich', other);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // …and a DIFFERENT key is a different ask, material notwithstanding
    expect(quizCacheKey('Deptford')).not.toBe(quizCacheKey('Greenwich'));
    await fetchQuiz('Deptford', stories);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('no quiz stays no quiz', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ quiz: null }) });

    expect(await fetchQuiz('Nowhere', stories)).toBeNull();
  });

  test('a v1 serving — questions without kinds — reads as no quiz, never a crash', async () => {
    const v1 = {
      areaName: 'Greenwich',
      questions: [
        {
          pageId: 1,
          title: 'Cutty Sark',
          question: 'What did she carry?',
          options: ['Tea', 'Coal', 'Gunpowder', 'Ice'],
          answerIndex: 0,
          because: 'Built for the China tea trade.',
        },
      ],
    };
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ quiz: v1 }) });

    expect(await fetchQuiz('Greenwich', stories)).toBeNull();
  });
});
