/**
 * The area quiz. A quiz ASSERTS things, which raises the stakes above
 * the tellings': a wrong answer marked right, or a citation pointing at
 * a story that isn't there, is worse than no quiz at all. So most of
 * this file is about what gets DROPPED — and v2's kinds each bring
 * their own way to be wrong.
 *
 * The getQuiz block at the bottom is about something else: WHERE the
 * material comes from. Nothing a caller writes may reach the prompt,
 * the options, or the cache slot (#303), and the slot is the area
 * rather than the ~111m bucket the reader happens to be in (#280).
 */
import { diskMapPolicies } from '@/server/ai-cache';
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
import { SparseRadiusMeters } from '@/server/sparse';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

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

// The two upstreams the quiz now derives itself from. Both are
// keyless and unmetered; neither is ever asked in a test.
const mockFindNearestArea = jest.fn<Promise<string | null>, [Coordinates]>();
jest.mock('@/server/area', () => ({
  findNearestArea: (...args: [Coordinates]) => mockFindNearestArea(...args),
}));

const mockFindNearbyHistory = jest.fn<Promise<HistoryItem[]>, [Coordinates, number?]>();
jest.mock('@/server/wikipedia', () => ({
  findNearbyHistory: (...args: [Coordinates, number?]) => mockFindNearbyHistory(...args),
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

/** Wikipedia's own answer for a spot: what findNearbyHistory returns. */
const place = (pageId: number, title: string, extract?: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.4826, longitude: -0.0077 },
  distanceMeters: pageId * 10,
  extract: extract ?? `The story of ${title}.`,
  url: `https://en.wikipedia.org/?curid=${pageId}`,
  source: 'Wikipedia',
});

/** The ground under the observatory, as Wikipedia hands it over. */
const ground: HistoryItem[] = [
  place(1, 'Crystal Palace Bowl', 'The Bowl opened in 1961 beside the lake.'),
  place(2, 'Crystal Palace Park', 'The park was laid out in 1854 around the relocated Palace.'),
  place(3, 'Crystal Palace Dinosaurs', 'The dinosaurs were unveiled in 1854, the first anywhere.'),
  place(4, 'Crystal Palace Subway', 'The subway of 1865 carried visitors under the road.'),
  place(5, 'Crystal Palace Transmitter', 'The transmitter went up in 1956 on the old Palace site.'),
];

const bowl: Coordinates = { latitude: 51.4223, longitude: -0.0684 };
// Far enough to be a different feed bucket, near enough to be the same
// named area — the crossing #280 is about
const dinosaurs: Coordinates = { latitude: 51.4241, longitude: -0.0702 };

beforeEach(() => {
  resetQuizForTests();
  jest.clearAllMocks();
  mockStoreGet.mockResolvedValue(undefined);
  mockFindNearestArea.mockResolvedValue('Crystal Palace');
  mockFindNearbyHistory.mockResolvedValue(ground);
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
    // The register is the product: guessable, delightful, short. These
    // four assertions read the sentences back out of the string the
    // line above just built, which is all they can do — the prompt is
    // an instruction, and whether it was OBEYED is asserted against
    // generated questions in "the register rule, enforced" below.
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

/**
 * The register rule, ENFORCED.
 *
 * "NEVER ask for a count, a measurement, or a bare year" was written
 * into the prompt after the first on-phone run served "how many men are
 * commemorated on the memorial", and the test that guarded it asserted
 * `prompt.toContain('NEVER ask for a count…')` — the prompt read back
 * at itself. Nothing anywhere checked a QUESTION, so the model could
 * ignore the paragraph (models do) and the failure would ship exactly
 * as it had before. These ask the served quiz instead.
 */
describe('the register rule, enforced against generated questions', () => {
  const memorial = subject(6, 'Crystal Palace war memorial', 'The memorial names 24 men of 1914-18.');
  const withMemorial = new Map(allowed).set(6, memorial);

  test('the question that shipped — "how many men" — is dropped', () => {
    const counted = anchor({
      pageId: 6,
      question: 'How many men are commemorated on the memorial?',
      options: ['24', '36', '48', '60'],
      answerIndex: 0,
    });

    expect(cleanQuizQuestion(counted, withMemorial)).toBeNull();
  });

  test('a hand of bare years is a recall test whatever the question says', () => {
    const dated = anchor({
      question: 'When was the Bowl opened?',
      options: ['1961', '1936', '1854', '1972'],
    });

    expect(cleanQuizQuestion(dated, allowed)).toBeNull();
  });

  test('…and so is a hand of measurements, separators and all', () => {
    expect(
      cleanQuizQuestion(anchor({ options: ['1,200', '2,400', '3,600', '4,800'] }), allowed)
    ).toBeNull();
    expect(
      cleanQuizQuestion(anchor({ options: ['1790-91', '1812', '1854', '1901'] }), allowed)
    ).toBeNull();
  });

  test('a reasonable-out answer survives, figures in its options and all', () => {
    // "How long did the fire burn" is the register the prompt asks for:
    // a stranger can reason it out and feel clever being right. The
    // rule is about bare figures, not about numbers appearing at all.
    expect(cleanQuizQuestion(anchor(), allowed)).not.toBeNull();
    expect(
      cleanQuizQuestion(
        anchor({ options: ['Five hours', 'Twenty minutes', '3 days', 'A fortnight'] }),
        allowed
      )
    ).not.toBeNull();
  });

  test('a unit word does not launder a figure — nor does "c."', () => {
    // "52 feet / 62 feet / …" is the measurement recall test in a
    // longer coat, and "1854 AD" is the bare-year hand wearing an era.
    expect(
      cleanQuizQuestion(anchor({ options: ['52 feet', '62 feet', '72 feet', '82 feet'] }), allowed)
    ).toBeNull();
    expect(
      cleanQuizQuestion(anchor({ options: ['1854 AD', '1865 AD', '1901 AD', '1936 AD'] }), allowed)
    ).toBeNull();
    expect(
      cleanQuizQuestion(anchor({ options: ['c. 1745', 'c. 1850', 'c. 1901', 'c. 1920'] }), allowed)
    ).toBeNull();
  });

  test('"which year" is a bare-year ask whatever the options wear', () => {
    // The options rule alone could be dressed past ("the year of the
    // Great Exhibition" as a wrong option); the stem cannot.
    expect(
      cleanQuizQuestion(
        anchor({
          question: 'In which year did the palace burn down?',
          options: ['1936', 'The year war broke out', '1901', 'The year of the Festival'],
        }),
        allowed
      )
    ).toBeNull();
  });

  test('ordinals lead names, and a hand of names survives', () => {
    // "1st Foot Guards" is a regiment, not a figure — the rule must
    // never eat a legitimate question to catch a lazy one.
    expect(
      cleanQuizQuestion(
        anchor({ options: ['1st Foot Guards', '3rd Hussars', '2nd Dragoons', '7th Lancers'] }),
        allowed
      )
    ).not.toBeNull();
  });

  test('a whole quiz of memorised figures is no quiz at all', async () => {
    // End to end: whatever the model returns, none of it reaches a
    // phone — and a broken quiz is null rather than a short one
    mockResearch.mockResolvedValue(
      fenced([
        anchor({ pageId: 1, question: 'How many arches?', options: ['4', '8', '12', '16'] }),
        anchor({ pageId: 2, options: ['1854', '1865', '1901', '1936'] }),
        anchor({ pageId: 3, options: ['1956', '1961', '1972', '1984'] }),
      ])
    );

    expect(await getQuiz(bowl)).toBeNull();
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

describe('getQuiz derives its own ground', () => {
  test('a fabricated request cannot write another client’s slot', async () => {
    // The whole of #303 in one assertion. getQuiz takes a place on
    // Earth and nothing else, so the only lever a caller has is WHERE.
    // Whatever it points at, the material comes back from Wikipedia:
    // the model reads the server's titles and extracts, and there is no
    // string anywhere in this call that a caller could have chosen.
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    await getQuiz(bowl);

    const prompt = mockResearch.mock.calls[0][0].prompt as string;
    for (const item of ground) {
      expect(prompt).toContain(item.title);
    }
    expect(mockFindNearbyHistory).toHaveBeenCalledWith(bowl);
    // …and the slot it writes is named by the area WE resolved, never
    // by anything that arrived with the request
    expect(mockStorePut).toHaveBeenCalledWith(
      'quiz',
      'v5:crystal palace',
      expect.anything(),
      expect.any(Number)
    );
  });

  test('the same area keys the same across bucket crossings', async () => {
    // A 2km walk crosses ~18 feed buckets. Under the old digest key
    // that was up to 18 calls out of the shared 300/day for one quiz
    // (#280); the area is one slot, so it is one call.
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    const here = await getQuiz(bowl);
    const twoBucketsOn = await getQuiz(dinosaurs);

    expect(here?.questions).toHaveLength(3);
    expect(twoBucketsOn).toBe(here);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    // The second crossing did not even re-fetch the ground
    expect(mockFindNearbyHistory).toHaveBeenCalledTimes(1);
  });

  test('the key is the area alone, and wears the version prefix', () => {
    // v5 orphans BOTH the shipped v3 digest keys and any v4 slot from
    // the area-keyed-but-client-fed design that was pulled back out.
    expect(quizKey('Crystal Palace')).toBe('v5:crystal palace');
    expect(quizKey('crystal palace')).toBe(quizKey('Crystal Palace'));
    expect(quizKey('Greenwich')).not.toBe(quizKey('Crystal Palace'));
  });

  test('the route refuses below the minimum usable stories WITHOUT calling', async () => {
    mockFindNearbyHistory.mockResolvedValue([place(1, 'One'), place(2, 'Two')]);
    expect(2).toBeLessThan(MinStoriesToQuiz);

    expect(await getQuiz(bowl)).toBeNull();

    expect(mockResearch).not.toHaveBeenCalled();
    // …and the emptiness is remembered, so the next open of the tab
    // does not re-fetch the ground to be told the same thing
    expect(mockStorePut).toHaveBeenCalledWith(
      'quiz',
      'v5:crystal palace',
      { quiz: null, at: expect.any(Number) },
      expect.any(Number)
    );
  });

  test('stories with no source text do not count towards the floor', async () => {
    mockFindNearbyHistory.mockResolvedValue([
      place(1, 'One'),
      place(2, 'Two', '   '),
      place(3, 'Three', ''),
    ]);

    expect(await getQuiz(bowl)).toBeNull();
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('nowhere here has a name: no quiz, and no ground fetched to find out', async () => {
    mockFindNearestArea.mockResolvedValue(null);

    expect(await getQuiz(bowl)).toBeNull();

    expect(mockFindNearbyHistory).not.toHaveBeenCalled();
    expect(mockResearch).not.toHaveBeenCalled();
    expect(mockStorePut).not.toHaveBeenCalled();
  });

  test('a plaque whose title is its whole inscription is never quizzed', async () => {
    // Found live: the first real quiz cited "This Turkish bronze gun was
    // cast in 1790-91 (AH 1212) in…", which reads as broken in the
    // citation link the question hangs off. It arrives already truncated
    // to 57 chars, so a length cap alone cannot see it.
    const truncated = 'This Turkish bronze gun was cast in 1790-91 (AH 1212) in…';
    expect(truncated.length).toBeLessThan(70);
    mockFindNearbyHistory.mockResolvedValue([...ground, place(99, truncated)]);
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    await getQuiz(bowl);

    const prompt = mockResearch.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain('Turkish bronze gun');
    expect(prompt).toContain('Crystal Palace Bowl');
  });

  test('an untruncated inscription is dropped on length too', async () => {
    const long =
      'This tablet commemorates the officers and men of the Royal Navy who fell in the action';
    mockFindNearbyHistory.mockResolvedValue([...ground, place(98, long)]);
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    await getQuiz(bowl);

    expect(mockResearch.mock.calls[0][0].prompt as string).not.toContain('This tablet commemorates');
  });

  test('sets a quiz, caches it, and the second ask spends nothing', async () => {
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    const first = await getQuiz(bowl);
    expect(first?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    // The free tier is the budget: the call is labelled and ungrounded
    expect(mockResearch.mock.calls[0][0]).toMatchObject({ label: 'quiz', grounded: false });

    const second = await getQuiz(bowl);
    expect(second?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('an unquizzable area is remembered — the tab must not re-burn a call on it', async () => {
    // Enough stories, but the model returns nothing usable
    mockResearch.mockResolvedValue(fenced([anchor({ pageId: 999 })]));

    expect(await getQuiz(bowl)).toBeNull();
    expect(await getQuiz(bowl)).toBeNull();
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('single-flight: two people in the same area join one call, and one fetch', async () => {
    let release: (value: string) => void = () => {};
    mockResearch.mockReturnValue(new Promise<string>((resolve) => (release = resolve)));

    const both = Promise.all([getQuiz(bowl), getQuiz(dinosaurs)]);
    release(fenced(threeAnchors));
    const [a, b] = await both;

    expect(a?.questions).toHaveLength(3);
    expect(b?.questions).toHaveLength(3);
    expect(mockResearch).toHaveBeenCalledTimes(1);
    expect(mockFindNearbyHistory).toHaveBeenCalledTimes(1);
  });

  test('the durable store answers before the ground is even fetched', async () => {
    // The cost model: a warm quiz is two cache reads and no network.
    // Fetching before the cache check would make every open of the tab
    // pay for upstream work the cached answer does not need.
    mockStoreGet.mockResolvedValue({
      value: { quiz: { areaName: 'Crystal Palace', questions: [] }, at: Date.now() },
      at: Date.now(),
    } as never);

    const quiz = await getQuiz(bowl);

    expect(quiz).toEqual({ areaName: 'Crystal Palace', questions: [] });
    expect(mockFindNearbyHistory).not.toHaveBeenCalled();
    expect(mockResearch).not.toHaveBeenCalled();
  });

  test('quiet ground widens on the feed’s own rule rather than losing its quiz', async () => {
    // The feed widens Wikipedia to 3km in a sparse area, so the stories
    // the reader can SEE are the wide ones. Deriving narrow would have
    // quietly taken the quiz away from every village that has one.
    mockFindNearbyHistory.mockResolvedValueOnce([place(1, 'The Old Rectory')]);
    mockFindNearbyHistory.mockResolvedValueOnce(ground);
    mockResearch.mockResolvedValue(fenced(threeAnchors));

    const quiz = await getQuiz(bowl);

    expect(quiz?.questions).toHaveLength(3);
    expect(mockFindNearbyHistory).toHaveBeenNthCalledWith(2, bowl, SparseRadiusMeters);
  });

  test('a rate-limited upstream is an error, never a cached “nothing here”', async () => {
    // Seven days of "no quiz" because Wikipedia was busy for a minute
    // is exactly the mistake area.ts refuses to make.
    mockFindNearbyHistory.mockRejectedValue(new Error('429 Too Many Requests'));

    await expect(getQuiz(bowl)).rejects.toThrow('429');
    expect(mockStorePut).not.toHaveBeenCalled();
  });
});

/**
 * The quiz keeps TWO clocks — 30 days for a quiz, 7 for a "nothing to
 * ask about here" verdict — and #309 gave the disk map a THIRD job,
 * pruning. Which of the two the prune takes is the whole decision, and
 * getting it wrong is silent: pruning at 7 days drops told quizzes that
 * the read would still have served, and every one of them costs a
 * free-tier call to write again.
 */
describe('the quiz cache keeps its two clocks', () => {
  const Days = 24 * 60 * 60 * 1000;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the map prunes on the LONGER clock — the read’s shorter one is peek’s job', () => {
    const policy = diskMapPolicies().get('quiz');

    expect(policy).toEqual({ ttlMs: 30 * Days, maxEntries: 1000 });
    // Said twice on purpose: this is the number a future edit would
    // "tidy" to 7 to match the verdict TTL, and nothing else would say so
    expect(policy!.ttlMs).toBeGreaterThan(7 * Days);
  });

  test('a told quiz is still served ten days on, without a second call', async () => {
    mockResearch.mockResolvedValue(fenced(threeAnchors));
    const told = await getQuiz(bowl);
    expect(told?.questions).toHaveLength(3);

    const tenDaysOn = Date.now() + 10 * Days;
    jest.spyOn(Date, 'now').mockReturnValue(tenDaysOn);

    expect(await getQuiz(bowl)).toEqual(told);
    expect(mockResearch).toHaveBeenCalledTimes(1);
  });

  test('…while a no-quiz verdict has expired by then, and the ground is asked again', async () => {
    mockFindNearbyHistory.mockResolvedValue([place(1, 'One'), place(2, 'Two')]);
    expect(await getQuiz(bowl)).toBeNull();
    // Thin ground widens once on the feed's own rule, so the count is
    // "however many that took", not one
    const asked = mockFindNearbyHistory.mock.calls.length;
    expect(asked).toBeGreaterThan(0);

    // Today: the verdict answers and nothing is re-fetched
    expect(await getQuiz(bowl)).toBeNull();
    expect(mockFindNearbyHistory).toHaveBeenCalledTimes(asked);

    const tenDaysOn = Date.now() + 10 * Days;
    jest.spyOn(Date, 'now').mockReturnValue(tenDaysOn);

    // A quiet corner may have grown a story in a week — the 7-day
    // verdict is a promise not to re-ask TOO often, not never again
    expect(await getQuiz(bowl)).toBeNull();
    expect(mockFindNearbyHistory.mock.calls.length).toBeGreaterThan(asked);
    expect(mockResearch).not.toHaveBeenCalled();
  });
});

