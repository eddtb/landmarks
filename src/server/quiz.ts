import { diskBackedMap } from '@/server/ai-cache';
import { research } from '@/server/ai-router';
import { extractAnswerText } from '@/server/gemini';
import { extractKeyPart } from '@/server/telling';
import { storeGet, storePut } from '@/server/telling-store';
import { Quiz, QuizQuestion } from '@/types/quiz';

/**
 * The area quiz: five questions about the ground you are standing on,
 * set by the app from the stories it found there.
 *
 * It is the app doing something with the history rather than handing it
 * over — a different quiz in every area, set from that area's own
 * stories, existing in no source anywhere. Each question cites the story
 * it came from, so answering one is an invitation to go and read it.
 *
 * The trust contract is the tellings' contract, at stakes: a question
 * whose answer isn't in the source is worse than no question, because a
 * quiz asserts. So facts may come only from the source text, every
 * question must name a story we actually supplied, and anything that
 * fails validation is dropped rather than shown.
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
 * dropped before the model ever sees it. Well clear of real names:
 * "Statue of Sir Walter Raleigh" is 28.
 */
const MaxTitleChars = 70;
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

/** What the client sends: the stories it has for this area. */
export type QuizSubject = { pageId: number; title: string; extract: string };

/**
 * The cache key binds the quiz to the material it was set from, exactly
 * as the telling's does: the area names the bucket (movement busts it),
 * and the source digest means a fabricated POST can only ever poison
 * its own slot, never the one real clients — who all send the same
 * stories for the same ground — read for the next 30 days.
 */
export async function quizKey(areaName: string, subjects: QuizSubject[]): Promise<string> {
  const material = subjects.map((s) => `${s.pageId}:${s.title}:${s.extract}`).join('\n');
  return `${areaName.toLowerCase()}:${await extractKeyPart(material)}`;
}

/** Pure and unit-tested: the contract the model must write to. */
export function quizPrompt(areaName: string, subjects: QuizSubject[]): string {
  return [
    `You set short local-history quizzes for a walking app. Set ${TargetQuestions} questions about ${areaName}, from the stories below.`,
    '',
    'Rules:',
    '- One question per story, each drawn from a DIFFERENT story. Never two questions about the same story.',
    '- Ask about the surprising, concrete thing — a date, a number, a person, what a place used to be. Never ask "what is interesting about X".',
    '- Exactly four options. One unambiguously correct. The wrong three must be plausible for the period and place, and clearly wrong to someone who has read the story — never a joke, never a near-synonym of the right answer.',
    '- The answer MUST be stated in that story\'s source text. If a story does not support a clean question, skip it and set fewer questions rather than inventing anything.',
    '- "because" is one sentence giving the fact, as a reader would want it after answering. Facts only from the source.',
    '- "pageId" MUST be the id of the story the question came from, copied exactly from the list below.',
    '- Return ONLY fenced JSON: {"questions": [{"pageId": 123, "question": "...", "options": ["...", "...", "...", "..."], "answerIndex": 0, "because": "..."}]}',
    '',
    'Stories:',
    ...subjects.map(
      (subject) =>
        `- pageId ${subject.pageId} — ${subject.title}: ${subject.extract.slice(0, SourceCharsPerStory)}`
    ),
  ].join('\n');
}

/**
 * Pure and unit-tested: one raw model question → a clean QuizQuestion,
 * or null when it isn't one. A quiz asserts things, so this is strict —
 * every drop here is a wrong answer a user never saw.
 */
export function cleanQuizQuestion(
  raw: unknown,
  allowed: Map<number, string>
): QuizQuestion | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const { pageId, question, options, answerIndex, because } = raw as Record<string, unknown>;

  // The citation must point at a story WE supplied: a pageId the model
  // invented would send a tap to a screen that isn't there
  if (typeof pageId !== 'number' || !allowed.has(pageId)) {
    return null;
  }
  if (typeof question !== 'string' || !question.trim()) {
    return null;
  }
  if (typeof because !== 'string' || !because.trim()) {
    return null;
  }
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
    pageId,
    // Ours, not the model's — see the type
    title: allowed.get(pageId) as string,
    question: question.trim(),
    options: cleanOptions,
    answerIndex,
    because: because.trim(),
  };
}

/**
 * Pure and unit-tested: the model's whole answer → a Quiz, or null when
 * too little of it survived to be one. One question per story, so a
 * model that asks three times about the same church yields one question.
 */
export function parseQuiz(
  areaName: string,
  text: string,
  subjects: QuizSubject[]
): Quiz | null {
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

  const allowed = new Map(subjects.map((subject) => [subject.pageId, subject.title]));
  const seen = new Set<number>();
  const questions: QuizQuestion[] = [];
  for (const raw of rawQuestions) {
    const question = cleanQuizQuestion(raw, allowed);
    if (!question || seen.has(question.pageId)) {
      continue;
    }
    seen.add(question.pageId);
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
export async function getQuiz(
  areaName: string,
  subjects: QuizSubject[]
): Promise<Quiz | null> {
  const usable = subjects
    .filter(
      (subject) =>
        subject.extract.trim().length > 0 && subject.title.trim().length <= MaxTitleChars
    )
    .slice(0, MaxStories);
  // The floor, before any key or call: no stories, no quiz
  if (usable.length < MinStoriesToQuiz) {
    return null;
  }

  const key = await quizKey(areaName, usable);
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
