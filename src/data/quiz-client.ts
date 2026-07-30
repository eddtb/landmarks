import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { Quiz, QuizQuestion } from '@/types/quiz';

/**
 * The quiz client: a session cache in front of one ask per area.
 *
 * A null quiz is cached exactly as a real one is — "no quiz for this
 * ground" is an answer, and re-asking it on every visit to the tab
 * would spend a free-tier call to be told the same thing.
 */

const cache = new Map<string, Quiz | null>();

export type QuizStory = { pageId: number; title: string; extract: string };

/**
 * Shuffle each question's options, remapping answerIndex to follow.
 *
 * Measured on every quiz the live route had generated: answerIndex was 0
 * on ALL of them — the prompt's JSON example shows 0 and the model puts
 * the right answer first, so Edd played a quiz whose answer was always A.
 * A quiz that predictable is not a quiz.
 *
 * Client-side deliberately, not in the server parse: the server's cache
 * holds quizzes for 30 days, so a server-side shuffle would bake ONE
 * order into every serving of a cached quiz (including the already-cached
 * ones, unshuffled forever). Here, every fetch deals fresh — and "Go
 * again" within a session keeps its order, since the session cache stores
 * the dealt hand.
 */
function dealt(question: QuizQuestion): QuizQuestion {
  const order = [0, 1, 2, 3];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...question,
    options: order.map((from) => question.options[from]),
    answerIndex: order.indexOf(question.answerIndex),
  };
}

/** The stories are the material; the area names the cache bucket. */
export async function fetchQuiz(areaName: string, stories: QuizStory[]): Promise<Quiz | null> {
  // The material is part of the identity: arriving somewhere new, or the
  // feed widening, must be able to produce a different quiz
  const key = `${areaName.toLowerCase()}:${stories.map((story) => story.pageId).join(',')}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(apiUrl('/api/quiz'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ area: areaName, stories }),
  });
  if (!response.ok) {
    throw new Error(`Quiz failed (${response.status})`);
  }
  const { quiz } = (await response.json()) as { quiz: Quiz | null };
  const settled =
    quiz && quiz.questions?.length
      ? { ...quiz, questions: quiz.questions.map(dealt) }
      : null;
  cache.set(key, settled);
  return settled;
}

/** Tests only: module state must not leak between them. */
export function resetQuizCacheForTests() {
  cache.clear();
}
