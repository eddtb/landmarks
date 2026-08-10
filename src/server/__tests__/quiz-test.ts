/**
 * The area quiz. A quiz ASSERTS things, which raises the stakes above
 * the tellings': a wrong answer marked right, or a citation pointing at
 * a story that isn't there, is worse than no quiz at all. So most of
 * this file is about what gets DROPPED — and v2's kinds each bring
 * their own way to be wrong.
 */
import {
  MinQuestions,
  MinStoriesToQuiz,
  QuizSubject,
  TargetQuestions,
  cleanQuizQuestion,
  getQuiz,
  parseQuiz,
  quizKey,
  quizPrompt,
  resetQuizForTests,
} from '@/server/quiz';

const mockResearch = jest.fn();
jest.mock('@/server/ai-router', () => ({
  research: (...args: unknown[]) => mockResearch(...args),
}));

const mockStoreGet = jest.fn(async () => undefined);
const mockStorePut = jest.fn(async () => {});
jest.mock('@/server/telling-store', () => ({
  storeGet: (...args: unknown[]) => mockStoreGet(...(args as [])),
  storePut: (...args: unknown[]) => mockStorePut(...(args as [])),
}));

const subject = (pageId: number, title: string, extract = `The story of ${title}.`) => ({
  pageId,
  title,
  extract,
});

const subjects: QuizSubject[] = [
  subject(1, 'Crystal Palace Bowl', 'The Bowl opened in 1961 beside the lake.'),
  subject(2, 'Crystal Palace Park', 'The park was laid out in 1854 around the relocated Palace.'),
  subject(3, 'Crystal Palace Dinosaurs', 'The dinosaurs were unveiled in 1854, the first anywhere.'),
  subject(4, 'Crystal Palace Subway', 'The subway of 1865 carried visitors under the road.'),
  subject(5, 'Crystal Palace Transmitter', 'The transmitter went up in 1956 on the old Palace site.'),
];

const allowed = new Map(subjects.map((s) => [s.pageId, s]));

const anchor = (overrides: Record<string, unknown> = {}) => ({
  kind: 'anchor',
  pageId: 1,
  question: 'How long did the Crystal Palace fire burn?',
  options: ['Five hours', 'Twenty minutes', 'Three days', 'A fortnight'],
  answerIndex: 0,
  because: 'The fire burned for five hours and was visible from Brighton.',
  ...overrides,
});

const whichPlace = (overrides: Record<string, unknown> = {}) => ({
  kind: 'which-place',
  pageId: 3,
  question: 'Unveiled in 1854, these were the first of their kind anywhere in the world. Which place?',
  distractorPageIds: [1, 2, 4],
  because: 'The dinosaurs came before the word "dinosaur" was fifty years old.',
  ...overrides,
});

const order = (overrides: Record<string, unknown> = {}) => ({
  kind: 'order',
  question: 'Oldest first — the order they arrived on this ground.',
  items: [
    { pageId: 2, year: 1854 },
    { pageId: 4, year: 1865 },
    { pageId: 5, year: 1956 },
  ],
  because: 'The park came first; the transmitter now stands where the Palace did.',
  ...overrides,
});

const trueFalse = (overrides: Record<string, unknown> = {}) => ({
  kind: 'true-false',
  pageId: 3,
  statement: 'The Crystal Palace dinosaurs were the first dinosaur sculptures anywhere.',
  answer: true,
  because: 'Unveiled in 1854 — the first anywhere.',
  ...overrides,
});

/** The model's answer, as the wire delivers it: fenced JSON. */
const fenced = (questions: unknown[]) => '```json\n' + JSON.stringify({ questions }) + '\n```';

/** Three anchors on distinct stories: the smallest valid quiz. */
const threeAnchors = [anchor({ pageId: 1 }), anchor({ pageId: 2 }), anchor({ pageId: 3 })];

beforeEach(() => {
  resetQuizForTests();
  jest.clearAllMocks();
  mockStoreGet.mockResolvedValue(undefined);
});

describe('quizPrompt', () => {
  test('names the area, carries every story with its pageId, and forbids invention', () => {
    const prompt = quizPrompt('Crystal Palace', subjects);

    expect(prompt).toContain('Crystal Palace');
    expect(prompt).toContain(`Set ${TargetQuestions} questions`);
    // The pageId must ride with the story, or the citation cannot be checked
    expect(prompt).toContain('pageId 3 — Crystal Palace Dinosaurs');
    // The trust contract, in the prompt as well as the validator
    expect(prompt).toContain("stated in the story's source text");
    expect(prompt).toContain('rather than inventing anything');
  });

  test('asks for the four kinds, with anchor as the fallback for thin material', () => {
    const prompt = quizPrompt('Crystal Palace', subjects);

    expect(prompt).toContain('"anchor"');
    expect(prompt).toContain('"which-place"');
    expect(prompt).toContain('"order"');
    expect(prompt).toContain('"true-false"');
    expect(prompt).toContain('fall back to an extra "anchor"');
  });

  test('asks for fun facts a stranger can reason out — never memorised figures', () => {
    // The first on-phone run asked "how many men are commemorated on
    // the memorial" — obedient to a prompt that requested "a number".
    // The register is the product: guessable, delightful, short.
    const prompt = quizPrompt('Crystal Palace', subjects);

    expect(prompt).toContain('tell a friend');
    expect(prompt).toContain('REASONING out the answer');
    expect(prompt).toContain('NEVER ask for a count, a measurement, or a bare year');
    expect(prompt).toContain('under 100 characters');
    expect(prompt).not.toContain('a date, a number, a person');
  });

  test('caps each story so a deep feed cannot make the model read everything', () => {
    const long = [subject(1, 'A', 'x'.repeat(50_000)), subject(2, 'B'), subject(3, 'C')];

    expect(quizPrompt('Nowhere', long).length).toBeLessThan(10_000);
  });
});

describe('cleanQuizQuestion drops what a quiz must never show', () => {
  test('an unknown kind, or none at all — v1 shapes included', () => {
    expect(cleanQuizQuestion(anchor({ kind: undefined }), allowed)).toBeNull();
    expect(cleanQuizQuestion(anchor({ kind: 'essay' }), allowed)).toBeNull();
  });

  describe('anchor', () => {
    test('a good question survives, and takes its title from OUR record', () => {
      const clean = cleanQuizQuestion(anchor({ title: 'A title the model made up' }), allowed);

      expect(clean).not.toBeNull();
      expect(clean?.title).toBe('Crystal Palace Bowl');
      expect(clean?.kind).toBe('anchor');
    });

    test('a pageId we never supplied — the citation would point nowhere', () => {
      expect(cleanQuizQuestion(anchor({ pageId: 999 }), allowed)).toBeNull();
      expect(cleanQuizQuestion(anchor({ pageId: '1' }), allowed)).toBeNull();
    });

    test('an answerIndex outside the options — the right answer would be unreachable', () => {
      expect(cleanQuizQuestion(anchor({ answerIndex: 4 }), allowed)).toBeNull();
      expect(cleanQuizQuestion(anchor({ answerIndex: -1 }), allowed)).toBeNull();
      expect(cleanQuizQuestion(anchor({ answerIndex: 1.5 }), allowed)).toBeNull();
      expect(cleanQuizQuestion(anchor({ answerIndex: '0' }), allowed)).toBeNull();
    });

    test('not exactly four options, or a blank one', () => {
      expect(cleanQuizQuestion(anchor({ options: ['One', 'Two', 'Three'] }), allowed)).toBeNull();
      expect(
        cleanQuizQuestion(anchor({ options: ['One', 'Two', 'Three', 'Four', 'Five'] }), allowed)
      ).toBeNull();
      expect(cleanQuizQuestion(anchor({ options: ['One', '  ', 'Three', 'Four'] }), allowed)).toBeNull();
    });

    test('two identical options — one of them is unanswerable', () => {
      expect(
        cleanQuizQuestion(anchor({ options: ['Five hours', 'five hours', 'A day', 'A week'] }), allowed)
      ).toBeNull();
    });

    test('no question, or no fact to give afterwards', () => {
      expect(cleanQuizQuestion(anchor({ question: '   ' }), allowed)).toBeNull();
      expect(cleanQuizQuestion(anchor({ because: '' }), allowed)).toBeNull();
    });
  });

  describe('which-place: the options are OUR titles, never the model\'s', () => {
    test('a good question builds its options from the cited story and three real neighbours', () => {
      const clean = cleanQuizQuestion(whichPlace(), allowed);

      expect(clean?.kind).toBe('which-place');
      if (clean?.kind !== 'which-place') {
        return;
      }
      // The right answer is the cited story's title, first on the wire —
      // the client deals the order, exactly as it does for anchors
      expect(clean.options[0]).toBe('Crystal Palace Dinosaurs');
      expect(clean.answerIndex).toBe(0);
      expect(clean.options).toEqual([
        'Crystal Palace Dinosaurs',
        'Crystal Palace Bowl',
        'Crystal Palace Park',
        'Crystal Palace Subway',
      ]);
    });

    test('a distractor we never supplied, or the subject itself, or a repeat', () => {
      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 2, 999] }), allowed)).toBeNull();
      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 2, 3] }), allowed)).toBeNull();
      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 1, 2] }), allowed)).toBeNull();
    });

    test('not exactly three distractors', () => {
      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 2] }), allowed)).toBeNull();
      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 2, 4, 5] }), allowed)).toBeNull();
    });

    test('two stories sharing a display title would be indistinguishable taps', () => {
      const twins = new Map(allowed);
      twins.set(6, subject(6, 'Crystal Palace Bowl'));

      expect(cleanQuizQuestion(whichPlace({ distractorPageIds: [1, 6, 2] }), twins)).toBeNull();
    });
  });

  describe('order: every year must be in its own story\'s source text', () => {
    test('a good question survives, sorted oldest first, citing its oldest item', () => {
      const shuffledWire = order({
        items: [
          { pageId: 5, year: 1956 },
          { pageId: 2, year: 1854 },
          { pageId: 4, year: 1865 },
        ],
      });
      const clean = cleanQuizQuestion(shuffledWire, allowed);

      expect(clean?.kind).toBe('order');
      if (clean?.kind !== 'order') {
        return;
      }
      expect(clean.items.map((item) => item.year)).toEqual([1854, 1865, 1956]);
      expect(clean.items.map((item) => item.title)).toEqual([
        'Crystal Palace Park',
        'Crystal Palace Subway',
        'Crystal Palace Transmitter',
      ]);
      expect(clean.pageId).toBe(2);
      expect(clean.title).toBe('Crystal Palace Park');
    });

    test('a year the source never states drops the question whole', () => {
      const invented = order({
        items: [
          { pageId: 2, year: 1854 },
          { pageId: 4, year: 1866 }, // the subway's extract says 1865
          { pageId: 5, year: 1956 },
        ],
      });

      expect(cleanQuizQuestion(invented, allowed)).toBeNull();
    });

    test('a tie cannot be ordered', () => {
      // Park and Dinosaurs both genuinely say 1854 — still unaskable
      const tie = order({
        items: [
          { pageId: 2, year: 1854 },
          { pageId: 3, year: 1854 },
          { pageId: 5, year: 1956 },
        ],
      });

      expect(cleanQuizQuestion(tie, allowed)).toBeNull();
    });

    test('a repeated story, a missing item, or a year that is not a year', () => {
      expect(
        cleanQuizQuestion(
          order({
            items: [
              { pageId: 2, year: 1854 },
              { pageId: 2, year: 1854 },
              { pageId: 5, year: 1956 },
            ],
          }),
          allowed
        )
      ).toBeNull();
      expect(
        cleanQuizQuestion(
          order({ items: [{ pageId: 2, year: 1854 }, { pageId: 4, year: 1865 }] }),
          allowed
        )
      ).toBeNull();
      expect(
        cleanQuizQuestion(
          order({
            items: [
              { pageId: 2, year: '1854' },
              { pageId: 4, year: 1865 },
              { pageId: 5, year: 1956 },
            ],
          }),
          allowed
        )
      ).toBeNull();
    });
  });

  describe('true-false', () => {
    test('a good statement survives, either way round', () => {
      expect(cleanQuizQuestion(trueFalse(), allowed)?.kind).toBe('true-false');
      expect(cleanQuizQuestion(trueFalse({ answer: false }), allowed)).not.toBeNull();
    });

    test('an answer that is not a boolean is not an answer', () => {
      expect(cleanQuizQuestion(trueFalse({ answer: 'true' }), allowed)).toBeNull();
      expect(cleanQuizQuestion(trueFalse({ answer: 1 }), allowed)).toBeNull();
    });

    test('no statement, no citation, no fact', () => {
      expect(cleanQuizQuestion(trueFalse({ statement: ' ' }), allowed)).toBeNull();
      expect(cleanQuizQuestion(trueFalse({ pageId: 999 }), allowed)).toBeNull();
      expect(cleanQuizQuestion(trueFalse({ because: '' }), allowed)).toBeNull();
    });
  });
});

describe('parseQuiz', () => {
  test('one question per story: a model that asks twice about one place yields one', () => {
    const quiz = parseQuiz(
      'Crystal Palace',
      JSON.stringify({
        questions: [
          anchor({ pageId: 1 }),
          anchor({ pageId: 1, question: 'Again about the Bowl?' }),
          anchor({ pageId: 2 }),
          anchor({ pageId: 3 }),
        ],
      }),
      subjects
    );

    expect(quiz?.questions.map((q) => q.pageId)).toEqual([1, 2, 3]);
  });

  test('order spends its three stories — an anchor about one of them is a repeat', () => {
    const quiz = parseQuiz(
      'Crystal Palace',
      JSON.stringify({
        questions: [order(), anchor({ pageId: 4 }), anchor({ pageId: 1 }), anchor({ pageId: 3 })],
      }),
      subjects
    );

    // The order question took 2, 4 and 5; the pageId-4 anchor must drop
    expect(quiz?.questions.map((q) => q.kind)).toEqual(['order', 'anchor', 'anchor']);
    expect(quiz?.questions.map((q) => q.pageId)).toEqual([2, 1, 3]);
  });

  test('a mixed hand survives whole', () => {
    const quiz = parseQuiz(
      'Crystal Palace',
      fenced([anchor({ pageId: 1 }), whichPlace(), trueFalse({ pageId: 5 })]).replace(/```(json)?/g, ''),
      subjects
    );

    expect(quiz?.questions.map((q) => q.kind)).toEqual(['anchor', 'which-place', 'true-false']);
  });

  test('fewer than the minimum is a broken quiz, not a short one', () => {
    const twoGood = parseQuiz(
      'Crystal Palace',
      JSON.stringify({ questions: [anchor({ pageId: 1 }), anchor({ pageId: 2 })] }),
      subjects
    );

    expect(MinQuestions).toBe(3);
    expect(twoGood).toBeNull();
  });

  test('never longer than the target, however many the model sends', () => {
    const many = parseQuiz(
      'Crystal Palace',
      JSON.stringify({
        questions: [...subjects.map((s) => anchor({ pageId: s.pageId })), trueFalse({ pageId: 1 })],
      }),
      subjects
    );

    expect(many?.questions).toHaveLength(TargetQuestions);
  });

  test('junk in, null out — never a half-built quiz', () => {
    expect(parseQuiz('Crystal Palace', 'not json at all', subjects)).toBeNull();
    expect(parseQuiz('Crystal Palace', JSON.stringify({ questions: 'nope' }), subjects)).toBeNull();
    expect(parseQuiz('Crystal Palace', JSON.stringify({}), subjects)).toBeNull();
  });
});

describe('getQuiz', () => {
  test('too few stories: no quiz, and NOT a wasted call', async () => {
    const thin = [subject(1, 'One'), subject(2, 'Two')];
    expect(thin.length).toBeLessThan(MinStoriesToQuiz);

    expect(await getQuiz('Nowhere', thin)).toBeNull();
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('stories with no source text do not count towards the floor', async () => {
    const blank = [subject(1, 'One'), subject(2, 'Two', '   '), subject(3, 'Three', '')];

    expect(await getQuiz('Nowhere', blank)).toBeNull();
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('a plaque whose title is its whole inscription is never quizzed', async () => {
    // Found live: the first real quiz cited "This Turkish bronze gun was
    // cast in 1790-91 (AH 1212) in…", which reads as broken in the
    // citation link the question hangs off
    // The EXACT string the feed sends — already truncated to 57 chars, so
    // a length cap alone does not see it. The first fix used only length
    // and the live route cited the gun anyway.
    const truncated = 'This Turkish bronze gun was cast in 1790-91 (AH 1212) in…';
    expect(truncated.length).toBeLessThan(70);
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    await getQuiz('Greenwich', [...subjects, subject(99, truncated)]);

    const prompt = mockResearch.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain('Turkish bronze gun');
    expect(prompt).toContain('Crystal Palace Bowl');
  });

  test('an untruncated inscription is dropped on length too', async () => {
    const long =
      'This tablet commemorates the officers and men of the Royal Navy who fell in the action';
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    await getQuiz('Greenwich', [...subjects, subject(98, long)]);

    expect(mockResearch.mock.calls[0][0].prompt as string).not.toContain('This tablet commemorates');
  });

  test('dropping the inscription can push an area below the floor', async () => {
    const inscription = 'A truncated inscription that ran out of room…';
    const thin = [subject(1, 'One'), subject(2, 'Two'), subject(3, inscription)];

    expect(await getQuiz('Nowhere', thin)).toBeNull();
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('sets a quiz, caches it, and the second ask spends nothing', async () => {
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    const first = await getQuiz('Crystal Palace', subjects);
    expect(first?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    // The free tier is the budget: the call is labelled and ungrounded
    expect(mockResearch.mock.calls[0][0]).toMatchObject({ label: 'quiz', grounded: false });
    // …and written where it outlives the worker
    expect(mockStorePut).toHaveBeenCalledWith(
      'quiz',
      expect.any(String),
      expect.anything(),
      expect.any(Number)
    );

    const second = await getQuiz('Crystal Palace', subjects);
    expect(second?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('an unquizzable area is remembered — the tab must not re-burn a call on it', async () => {
    // Enough stories, but the model returns nothing usable
    mockResearch.mockResolvedValue(fenced([anchor({ pageId: 999 })]));

    expect(await getQuiz('Crystal Palace', subjects)).toBeNull();
    expect(await getQuiz('Crystal Palace', subjects)).toBeNull();
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('single-flight: two people in the same place join one call', async () => {
    let release: (value: string) => void = () => {};
    mockResearch.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

    const both = Promise.all([
      getQuiz('Crystal Palace', subjects),
      getQuiz('Crystal Palace', subjects),
    ]);
    release(fenced(threeAnchors));
    const [a, b] = await both;

    expect(a?.questions).toHaveLength(3);
    expect(b?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('the durable store answers before the model does', async () => {
    mockStoreGet.mockResolvedValue({
      value: { quiz: { areaName: 'Crystal Palace', questions: [] }, at: Date.now() },
      at: Date.now(),
    } as never);

    const quiz = await getQuiz('Crystal Palace', subjects);

    expect(quiz).toEqual({ areaName: 'Crystal Palace', questions: [] });
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('the key binds the area AND its material — and wears the version prefix', async () => {
    const keyA = await quizKey('Crystal Palace', subjects);
    const keyB = await quizKey('Crystal Palace', [...subjects.slice(1), subject(6, 'A new find')]);
    const keyC = await quizKey('Greenwich', subjects);

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    // The prefix retires every older slot when the CONTRACT changes:
    // v2 added kinds; v3 changed the question register (the trivia-
    // register quizzes must not serve for 30 days under old keys).
    // The area names the bucket, so movement always busts it.
    expect(keyA.startsWith('v3:crystal palace:')).toBe(true);
  });

  test('the same twelve stories in a different order are the same key', async () => {
    // The feed is distance-sorted from the reader's ~111m bucket, so a
    // few paces re-orders it without changing it. An order-sensitive
    // join spent a free-tier call on that (#280).
    const shuffled = [subjects[3], subjects[0], subjects[4], subjects[2], subjects[1]];

    expect(await quizKey('Crystal Palace', shuffled)).toBe(
      await quizKey('Crystal Palace', subjects)
    );
  });
});
