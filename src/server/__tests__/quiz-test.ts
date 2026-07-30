/**
 * The area quiz. A quiz ASSERTS things, which raises the stakes above
 * the tellings': a wrong answer marked right, or a citation pointing at
 * a story that isn't there, is worse than no quiz at all. So most of
 * this file is about what gets DROPPED.
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
  subject(1, 'Crystal Palace Bowl'),
  subject(2, 'Crystal Palace Park'),
  subject(3, 'Crystal Palace Dinosaurs'),
  subject(4, 'Crystal Palace Subway'),
  subject(5, 'Crystal Palace Transmitter'),
];

const allowed = new Map(subjects.map((s) => [s.pageId, s.title]));

const question = (overrides: Record<string, unknown> = {}) => ({
  pageId: 1,
  question: 'How long did the Crystal Palace fire burn?',
  options: ['Five hours', 'Twenty minutes', 'Three days', 'A fortnight'],
  answerIndex: 0,
  because: 'The fire burned for five hours and was visible from Brighton.',
  ...overrides,
});

/** The model's answer, as the wire delivers it: fenced JSON. */
const fenced = (questions: unknown[]) =>
  '```json\n' + JSON.stringify({ questions }) + '\n```';

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
    expect(prompt).toContain("stated in that story's source text");
    expect(prompt).toContain('rather than inventing anything');
  });

  test('caps each story so a deep feed cannot make the model read everything', () => {
    const long = [subject(1, 'A', 'x'.repeat(50_000)), subject(2, 'B'), subject(3, 'C')];

    expect(quizPrompt('Nowhere', long).length).toBeLessThan(10_000);
  });
});

describe('cleanQuizQuestion drops what a quiz must never show', () => {
  test('a good question survives, and takes its title from OUR record', () => {
    const clean = cleanQuizQuestion(question({ title: 'A title the model made up' }), allowed);

    expect(clean).not.toBeNull();
    expect(clean?.title).toBe('Crystal Palace Bowl');
    expect(clean?.answerIndex).toBe(0);
  });

  test('a pageId we never supplied — the citation would point nowhere', () => {
    expect(cleanQuizQuestion(question({ pageId: 999 }), allowed)).toBeNull();
    expect(cleanQuizQuestion(question({ pageId: '1' }), allowed)).toBeNull();
  });

  test('an answerIndex outside the options — the right answer would be unreachable', () => {
    expect(cleanQuizQuestion(question({ answerIndex: 4 }), allowed)).toBeNull();
    expect(cleanQuizQuestion(question({ answerIndex: -1 }), allowed)).toBeNull();
    expect(cleanQuizQuestion(question({ answerIndex: 1.5 }), allowed)).toBeNull();
    expect(cleanQuizQuestion(question({ answerIndex: '0' }), allowed)).toBeNull();
  });

  test('not exactly four options, or a blank one', () => {
    expect(cleanQuizQuestion(question({ options: ['One', 'Two', 'Three'] }), allowed)).toBeNull();
    expect(
      cleanQuizQuestion(question({ options: ['One', 'Two', 'Three', 'Four', 'Five'] }), allowed)
    ).toBeNull();
    expect(cleanQuizQuestion(question({ options: ['One', '  ', 'Three', 'Four'] }), allowed)).toBeNull();
  });

  test('two identical options — one of them is unanswerable', () => {
    expect(
      cleanQuizQuestion(question({ options: ['Five hours', 'five hours', 'A day', 'A week'] }), allowed)
    ).toBeNull();
  });

  test('no question, or no fact to give afterwards', () => {
    expect(cleanQuizQuestion(question({ question: '   ' }), allowed)).toBeNull();
    expect(cleanQuizQuestion(question({ because: '' }), allowed)).toBeNull();
  });
});

describe('parseQuiz', () => {
  test('one question per story: a model that asks twice about one place yields one', () => {
    const quiz = parseQuiz(
      'Crystal Palace',
      JSON.stringify({
        questions: [
          question({ pageId: 1 }),
          question({ pageId: 1, question: 'Again about the Bowl?' }),
          question({ pageId: 2 }),
          question({ pageId: 3 }),
        ],
      }),
      subjects
    );

    expect(quiz?.questions.map((q) => q.pageId)).toEqual([1, 2, 3]);
  });

  test('fewer than the minimum is a broken quiz, not a short one', () => {
    const twoGood = parseQuiz(
      'Crystal Palace',
      JSON.stringify({ questions: [question({ pageId: 1 }), question({ pageId: 2 })] }),
      subjects
    );

    expect(MinQuestions).toBe(3);
    expect(twoGood).toBeNull();
  });

  test('a shorter quiz IS allowed above the floor — a quiet corner still gets one', () => {
    const three = parseQuiz(
      'Crystal Palace',
      JSON.stringify({
        questions: [question({ pageId: 1 }), question({ pageId: 2 }), question({ pageId: 3 })],
      }),
      subjects
    );

    expect(three?.questions).toHaveLength(3);
  });

  test('never longer than the target, however many the model sends', () => {
    const many = parseQuiz(
      'Crystal Palace',
      JSON.stringify({ questions: subjects.map((s) => question({ pageId: s.pageId })) }),
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

  test('sets a quiz, caches it, and the second ask spends nothing', async () => {
    mockResearch.mockResolvedValue(
      fenced([question({ pageId: 1 }), question({ pageId: 2 }), question({ pageId: 3 })])
    );

    const first = await getQuiz('Crystal Palace', subjects);
    expect(first?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    // The free tier is the budget: the call is labelled and ungrounded
    expect(mockResearch.mock.calls[0][0]).toMatchObject({ label: 'quiz', grounded: false });
    // …and written where it outlives the worker
    expect(mockStorePut).toHaveBeenCalledWith('quiz', expect.any(String), expect.anything(), expect.any(Number));

    const second = await getQuiz('Crystal Palace', subjects);
    expect(second?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('an unquizzable area is remembered — the tab must not re-burn a call on it', async () => {
    // Enough stories, but the model returns nothing usable
    mockResearch.mockResolvedValue(fenced([question({ pageId: 999 })]));

    expect(await getQuiz('Crystal Palace', subjects)).toBeNull();
    expect(await getQuiz('Crystal Palace', subjects)).toBeNull();
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('single-flight: two people in the same place join one call', async () => {
    let release: (value: string) => void = () => {};
    mockResearch.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

    const both = Promise.all([getQuiz('Crystal Palace', subjects), getQuiz('Crystal Palace', subjects)]);
    release(fenced([question({ pageId: 1 }), question({ pageId: 2 }), question({ pageId: 3 })]));
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

  test('the key binds the area AND its material: new stories, new quiz', async () => {
    const keyA = await quizKey('Crystal Palace', subjects);
    const keyB = await quizKey('Crystal Palace', [...subjects.slice(1), subject(6, 'A new find')]);
    const keyC = await quizKey('Greenwich', subjects);

    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
    // The area names the bucket, so movement always busts it
    expect(keyA.startsWith('crystal palace:')).toBe(true);
  });
});
