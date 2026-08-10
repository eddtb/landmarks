import { diskBackedMap } from '@/server/ai-cache';
import { research } from '@/server/ai-router';
import { extractAnswerText } from '@/server/gemini';
import { storeGet, storePut } from '@/server/telling-store';
import {
  AnchorQuestion,
  OrderItem,
  OrderQuestion,
  Quiz,
  QuizQuestion,
  TrueFalseQuestion,
  WhichPlaceQuestion,
  quizCacheKey,
} from '@/types/quiz';

/**
 * The area quiz: five questions about the ground you are standing on,
 * set by the app from the stories it found there.
 *
 * It is the app doing something with the history rather than handing it
 * over — a different quiz in every area, set from that area's own
 * stories, existing in no source anywhere. Each question cites the story
 * it came from, so answering one is an invitation to go and read it.
 *
 * v2 asks in four registers instead of one: the anchor (the concrete
 * surprise), which-place (the fact given, the place asked — every
 * option a real story we supplied), order (three places into the order
 * they arrived), and true-or-myth. The mix tests understanding of the
 * ground, not recall of an extract.
 *
 * The trust contract is the tellings' contract, at stakes: a question
 * whose answer isn't in the source is worse than no question, because a
 * quiz asserts. So facts may come only from the source text, every
 * question must name a story we actually supplied, and anything that
 * fails validation is dropped rather than shown. v2 tightens it per
 * kind: which-place options are OUR titles keyed by pageId (the model
 * cannot misname a place), and an order item whose year is not literally
 * in its own extract drops the whole question.
 */

/** What we aim for, and the fewest that is still a quiz. Quiet corners
 *  get a shorter quiz — never an empty tab. */
export const TargetQuestions = 5;
export const MinQuestions = 3;
/** Fewer stories than this and there is nothing to set a quiz from. */
export const MinStoriesToQuiz = 3;
/** Per story, so a deep feed cannot make the model read 150 extracts. */
const SourceCharsPerStory = 1200;
/**
 * A place has a NAME. A plaque's "title" in this data is its entire
 * inscription, and the first live quiz duly cited "This Turkish bronze
 * gun was cast in 1790-91 (AH 1212) in…" — which renders as a broken
 * sentence in the citation link the question hangs off. Such a record
 * also makes a poorer question subject than a named place, so it is
 * dropped before the model ever sees it.
 *
 * Two signals, because the first attempt at this used only the length
 * and the live route still cited the gun: the feed hands over titles
 * ALREADY truncated (that one arrives at 57 characters), so length alone
 * cannot see it. A trailing ellipsis means the title was cut, and a cut
 * title is never a name. The cap then catches the untruncated ones,
 * staying well clear of real names — "Statue of Sir Walter Raleigh" is
 * 28.
 */
const MaxTitleChars = 70;

/** A name is not a sentence that ran out of room. */
function isNamedPlace(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MaxTitleChars &&
    !trimmed.endsWith('…') &&
    !trimmed.endsWith('...')
  );
}
/** The nearest dozen: the ground you are on, not the whole 3km. */
const MaxStories = 12;

const TtlMs = 30 * 24 * 60 * 60 * 1000;
/** An area too thin to quiz is remembered too — every open of that tab
 *  must NOT re-burn a free-tier call discovering the same emptiness. */
const NoQuizTtlMs = 7 * 24 * 60 * 60 * 1000;

type CachedQuiz = { quiz: Quiz | null; at: number };
const cache = diskBackedMap<CachedQuiz>('quiz');
// One generation per area at a time: two people opening the tab in the
// same place join one call instead of spending two
const inFlight = new Map<string, Promise<Quiz | null>>();

/**
 * What the client sends: the stories it has for this area — MATERIAL,
 * not identity (the key is the area alone: quizCacheKey).
 *
 * The digest that used to bind them into the key was also this route's
 * fabrication guard, and it went with them: a crafted POST now writes
 * the slot every real client in that area reads for 30 days, where
 * before it could only ever poison its own. That is the price of #280 —
 * the alternative was a cache keyed to the ~111m feed bucket, re-spending
 * the shared free tier on every walk. Unlike retold's area key, which
 * carries no trust because its source is fetched here, this material
 * arrives from the client. Tracked in #303; AGENTS.md's table says so.
 */
export type QuizSubject = { pageId: number; title: string; extract: string };

/** Pure and unit-tested: the contract the model must write to. */
export function quizPrompt(areaName: string, subjects: QuizSubject[]): string {
  return [
    `You set short local-history quizzes for a walking app. Set ${TargetQuestions} questions about ${areaName}, from the stories below.`,
    '',
    'The mix (fall back to an extra "anchor" whenever the material cannot support a kind — never invent):',
    '- 2 of kind "anchor": the fun fact — the thing about the place you would tell a friend walking past it. What it was, what happened there, who turned up, what is odd about it. A stranger should have a fighting chance of REASONING out the answer from common sense, and feel clever when right. NEVER ask for a count, a measurement, or a bare year — a memorised figure is trivia, not knowledge of the ground. Exactly four options, one unambiguously correct; the wrong three plausible and entertaining, never a joke, never a near-synonym of the right answer.',
    '- 1 of kind "which-place": state a fact from one story, ask WHICH place it belongs to. Give "distractorPageIds": the ids of THREE OTHER stories from the list whose places make plausible wrong answers. Do not write place names yourself — the ids are the options.',
    '- 1 of kind "order": three stories whose source text each states a year for the place\'s founding, building, or arrival. "items" lists them OLDEST FIRST with that year, copied exactly as the source states it. Only set this if three stories genuinely state years.',
    '- 1 of kind "true-false": one statement about a story, answered true or false. A false statement must be a plausible misreading of the source, not a joke. Roughly half your true-false statements across quizzes should be false.',
    '',
    'Rules for every question:',
    '- Keep the question under 100 characters — it shares one phone screen with its options.',
    '- Each drawn from a DIFFERENT story ("order" spends three at once). Never two questions about the same story.',
    '- Facts MUST be stated in the story\'s source text. If a story does not support a clean question, skip it and set fewer questions rather than inventing anything.',
    '- "because" is one sentence giving the fact, as a reader would want it after answering — for a false statement, the correction. Facts only from the source.',
    '- Every "pageId" MUST be copied exactly from the list below.',
    '- Return ONLY fenced JSON: {"questions": [',
    '  {"kind": "anchor", "pageId": 123, "question": "...", "options": ["...", "...", "...", "..."], "answerIndex": 0, "because": "..."},',
    '  {"kind": "which-place", "pageId": 123, "question": "...", "distractorPageIds": [45, 67, 89], "because": "..."},',
    '  {"kind": "order", "question": "...", "items": [{"pageId": 45, "year": 1616}, {"pageId": 67, "year": 1675}, {"pageId": 89, "year": 1869}], "because": "..."},',
    '  {"kind": "true-false", "pageId": 123, "statement": "...", "answer": true, "because": "..."}',
    ']}',
    '',
    'Stories:',
    ...subjects.map(
      (subject) =>
        `- pageId ${subject.pageId} — ${subject.title}: ${subject.extract.slice(0, SourceCharsPerStory)}`
    ),
  ].join('\n');
}

/** The two strings every kind must carry, trimmed, or null. */
function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A pageId is only a pageId if it names a story we supplied. */
function cleanPageId(value: unknown, allowed: Map<number, QuizSubject>): number | null {
  return typeof value === 'number' && allowed.has(value) ? value : null;
}

function cleanAnchor(
  raw: Record<string, unknown>,
  allowed: Map<number, QuizSubject>
): AnchorQuestion | null {
  const pageId = cleanPageId(raw.pageId, allowed);
  const question = cleanText(raw.question);
  const because = cleanText(raw.because);
  if (pageId === null || !question || !because) {
    return null;
  }
  const { options, answerIndex } = raw;
  if (!Array.isArray(options) || options.length !== 4) {
    return null;
  }
  const cleanOptions = options.map((option) => (typeof option === 'string' ? option.trim() : ''));
  if (cleanOptions.some((option) => !option)) {
    return null;
  }
  // Two identical options means one of them is unanswerable
  if (new Set(cleanOptions.map((option) => option.toLowerCase())).size !== 4) {
    return null;
  }
  if (
    typeof answerIndex !== 'number' ||
    !Number.isInteger(answerIndex) ||
    answerIndex < 0 ||
    answerIndex > 3
  ) {
    return null;
  }
  return {
    kind: 'anchor',
    pageId,
    // Ours, not the model's — see the type
    title: (allowed.get(pageId) as QuizSubject).title,
    question,
    options: cleanOptions,
    answerIndex,
    because,
  };
}

/**
 * The model names distractors by pageId; the options are OUR titles.
 * The right answer is always the cited story's title, first on the wire
 * — the client deals the order, exactly as it does for anchors.
 */
function cleanWhichPlace(
  raw: Record<string, unknown>,
  allowed: Map<number, QuizSubject>
): WhichPlaceQuestion | null {
  const pageId = cleanPageId(raw.pageId, allowed);
  const question = cleanText(raw.question);
  const because = cleanText(raw.because);
  if (pageId === null || !question || !because) {
    return null;
  }
  const { distractorPageIds } = raw;
  if (!Array.isArray(distractorPageIds) || distractorPageIds.length !== 3) {
    return null;
  }
  const distractors: number[] = [];
  for (const rawId of distractorPageIds) {
    const id = cleanPageId(rawId, allowed);
    if (id === null || id === pageId || distractors.includes(id)) {
      return null;
    }
    distractors.push(id);
  }
  const title = (allowed.get(pageId) as QuizSubject).title;
  const options = [title, ...distractors.map((id) => (allowed.get(id) as QuizSubject).title)];
  // Two stories can share a display title (twin plaques); as options
  // they would be indistinguishable taps
  if (new Set(options.map((option) => option.toLowerCase())).size !== 4) {
    return null;
  }
  return {
    kind: 'which-place',
    pageId,
    title,
    question,
    options,
    answerIndex: 0,
    because,
  };
}

/**
 * Order is the strictest kind because it is the most checkable: every
 * item's year must appear, as written, in that story's own extract.
 * A year the source never states drops the question whole — a timeline
 * is an assertion three times over.
 */
function cleanOrder(
  raw: Record<string, unknown>,
  allowed: Map<number, QuizSubject>
): OrderQuestion | null {
  const question = cleanText(raw.question);
  const because = cleanText(raw.because);
  if (!question || !because) {
    return null;
  }
  const { items } = raw;
  if (!Array.isArray(items) || items.length !== 3) {
    return null;
  }
  const cleanItems: OrderItem[] = [];
  for (const rawItem of items) {
    if (typeof rawItem !== 'object' || rawItem === null) {
      return null;
    }
    const { pageId: rawId, year } = rawItem as Record<string, unknown>;
    const pageId = cleanPageId(rawId, allowed);
    if (pageId === null || cleanItems.some((item) => item.pageId === pageId)) {
      return null;
    }
    if (typeof year !== 'number' || !Number.isInteger(year)) {
      return null;
    }
    const subject = allowed.get(pageId) as QuizSubject;
    if (!subject.extract.includes(String(year))) {
      return null;
    }
    cleanItems.push({ pageId, title: subject.title, year });
  }
  // Oldest first on the wire, and strictly so — a tie cannot be ordered
  const sorted = [...cleanItems].sort((a, b) => a.year - b.year);
  if (sorted[0].year === sorted[1].year || sorted[1].year === sorted[2].year) {
    return null;
  }
  return {
    kind: 'order',
    // The question cites its oldest item; the reveal links every item
    pageId: sorted[0].pageId,
    title: sorted[0].title,
    question,
    items: sorted,
    because,
  };
}

function cleanTrueFalse(
  raw: Record<string, unknown>,
  allowed: Map<number, QuizSubject>
): TrueFalseQuestion | null {
  const pageId = cleanPageId(raw.pageId, allowed);
  const statement = cleanText(raw.statement);
  const because = cleanText(raw.because);
  if (pageId === null || !statement || !because || typeof raw.answer !== 'boolean') {
    return null;
  }
  return {
    kind: 'true-false',
    pageId,
    title: (allowed.get(pageId) as QuizSubject).title,
    statement,
    answer: raw.answer,
    because,
  };
}

/**
 * Pure and unit-tested: one raw model question → a clean QuizQuestion,
 * or null when it isn't one. A quiz asserts things, so this is strict —
 * every drop here is a wrong answer a user never saw.
 */
export function cleanQuizQuestion(
  raw: unknown,
  allowed: Map<number, QuizSubject>
): QuizQuestion | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  switch (record.kind) {
    case 'anchor':
      return cleanAnchor(record, allowed);
    case 'which-place':
      return cleanWhichPlace(record, allowed);
    case 'order':
      return cleanOrder(record, allowed);
    case 'true-false':
      return cleanTrueFalse(record, allowed);
    default:
      return null;
  }
}

/** Every story a question spends — order spends its three items. */
function pageIdsSpent(question: QuizQuestion): number[] {
  return question.kind === 'order' ? question.items.map((item) => item.pageId) : [question.pageId];
}

/**
 * Pure and unit-tested: the model's whole answer → a Quiz, or null when
 * too little of it survived to be one. One question per story — order
 * spends three stories at once, and a model that asks three times about
 * the same church yields one question.
 */
export function parseQuiz(areaName: string, text: string, subjects: QuizSubject[]): Quiz | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const rawQuestions = (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(rawQuestions)) {
    return null;
  }

  const allowed = new Map(subjects.map((subject) => [subject.pageId, subject]));
  const seen = new Set<number>();
  const questions: QuizQuestion[] = [];
  for (const raw of rawQuestions) {
    const question = cleanQuizQuestion(raw, allowed);
    if (!question || pageIdsSpent(question).some((pageId) => seen.has(pageId))) {
      continue;
    }
    for (const pageId of pageIdsSpent(question)) {
      seen.add(pageId);
    }
    questions.push(question);
    if (questions.length === TargetQuestions) {
      break;
    }
  }

  // Fewer than MinQuestions is not a short quiz, it is a broken one
  return questions.length >= MinQuestions ? { areaName, questions } : null;
}

/** A cached quiz (or a cached "no quiz here"), or undefined for a miss. */
function peek(key: string): { quiz: Quiz | null } | undefined {
  const hit = cache.get(key);
  if (!hit) {
    return undefined;
  }
  const ttl = hit.quiz ? TtlMs : NoQuizTtlMs;
  if (Date.now() - hit.at > ttl) {
    cache.delete(key);
    return undefined;
  }
  return { quiz: hit.quiz };
}

/**
 * The quiz for an area, from cache where possible. Null means "no quiz
 * for this ground" — too few stories, or too little in them to ask
 * about honestly — and that verdict is cached too.
 */
export async function getQuiz(areaName: string, subjects: QuizSubject[]): Promise<Quiz | null> {
  const usable = subjects
    .filter((subject) => subject.extract.trim().length > 0 && isNamedPlace(subject.title))
    // The nearest twelve — the cap comes BEFORE the sort, or "nearest"
    // would mean "lowest pageId", which is nothing at all
    .slice(0, MaxStories)
    // …then sorted, so the prompt is a function of the SET and not of
    // the order the feed handed it over in. The feed is distance-sorted
    // from the asker's ~111m bucket; without this, the same twelve
    // stories asked for from a few paces away would write a different
    // quiz into the one area slot on the next regeneration.
    .sort((a, b) => a.pageId - b.pageId);
  // The floor, before any key or call: no stories, no quiz
  if (usable.length < MinStoriesToQuiz) {
    return null;
  }

  const key = quizCacheKey(areaName);
  const peeked = peek(key);
  if (peeked !== undefined) {
    return peeked.quiz;
  }

  // The durable store outlives the worker the per-process map dies with
  const stored = await storeGet<CachedQuiz>('quiz', key);
  if (stored) {
    const ttl = stored.value.quiz ? TtlMs : NoQuizTtlMs;
    if (Date.now() - stored.value.at <= ttl) {
      cache.set(key, stored.value);
      return stored.value.quiz;
    }
  }

  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const generation = (async (): Promise<Quiz | null> => {
    const text = await research({
      prompt: quizPrompt(areaName, usable),
      maxTokens: 2048,
      grounded: false,
      label: 'quiz',
    });
    const quiz = parseQuiz(areaName, extractAnswerText([{ text }]), usable);
    const entry: CachedQuiz = { quiz, at: Date.now() };
    cache.set(key, entry);
    // Awaited, not fire-and-forget: Workers freeze the isolate the
    // moment the response returns and kill in-flight promises
    await storePut('quiz', key, entry, entry.at);
    return quiz;
  })();

  inFlight.set(key, generation);
  try {
    return await generation;
  } finally {
    inFlight.delete(key);
  }
}

/** Tests only: module state must not leak between them. */
export function resetQuizForTests() {
  cache.clear();
  inFlight.clear();
}
