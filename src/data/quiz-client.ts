import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { Quiz, QuizQuestion } from '@/types/quiz';
import { Coordinates } from '@/utils/geo';

/**
 * The quiz client: a session cache in front of one ask per area.
 *
 * A null quiz is cached exactly as a real one is — "no quiz for this
 * ground" is an answer, and re-asking it on every visit to the tab
 * would spend a free-tier call to be told the same thing.
 */

const cache = new Map<string, Quiz | null>();

/** A fresh dealing of [0..count): Fisher–Yates. */
function dealtOrder(count: number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/**
 * Shuffle what the wire deliberately leaves ordered.
 *
 * Measured on every quiz the live route had generated: answerIndex was 0
 * on ALL of them — the prompt's JSON example shows 0 and the model puts
 * the right answer first, so Edd played a quiz whose answer was always A.
 * A quiz that predictable is not a quiz. v2 makes the pattern load-
 * bearing: which-place questions ALWAYS arrive with the right answer
 * first (the server builds them that way), and order questions arrive
 * oldest-first because that IS the answer.
 *
 * Client-side deliberately, not in the server parse: the server's cache
 * holds quizzes for 30 days, so a server-side shuffle would bake ONE
 * order into every serving of a cached quiz. Here, every fetch deals
 * fresh — and "Go again" within a session keeps its order, since the
 * session cache stores the dealt hand.
 */
function dealt(question: QuizQuestion): QuizQuestion {
  switch (question.kind) {
    case 'anchor':
    case 'which-place': {
      const order = dealtOrder(question.options.length);
      return {
        ...question,
        options: order.map((from) => question.options[from]),
        answerIndex: order.indexOf(question.answerIndex),
      };
    }
    case 'order': {
      // The wire's item order is the ANSWER; the client's presentation
      // must not be. The dealt hand carries the shuffled presentation,
      // and the correct order remains recoverable by year.
      let order = dealtOrder(question.items.length);
      // A shuffle can deal the solved arrangement — that is a question
      // answered by doing nothing, so deal it off the top instead
      if (order.every((from, index) => from === index)) {
        order = [order[order.length - 1], ...order.slice(0, -1)];
      }
      return { ...question, items: order.map((from) => question.items[from]) };
    }
    case 'true-false':
      // Truth cannot be re-dealt
      return question;
  }
}

/** The correct arrangement of a dealt order question: oldest first. */
export function orderedByYear<Item extends { year: number }>(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.year - b.year);
}

/**
 * The quiz for the ground the reader is standing on.
 *
 * Two arguments doing two different jobs. `center` is what goes on the
 * wire, and it is ALL that goes on the wire: the route derives its own
 * stories from it now, so the app no longer hands the server material
 * to quiz from (#303). `areaName` never leaves the device — it is the
 * session cache's key, and it is the area rather than the position on
 * purpose: the server holds one quiz per area for 30 days, so walking
 * the length of Greenwich should not send a single further request
 * (#280). The name the client caches under is the same canonical
 * article title the server will resolve those coordinates to.
 */
export async function fetchQuiz(areaName: string, center: Coordinates): Promise<Quiz | null> {
  const key = areaName.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(
    apiUrl(`/api/quiz?lat=${center.latitude}&lng=${center.longitude}`)
  );
  if (!response.ok) {
    throw new Error(`Quiz failed (${response.status})`);
  }
  const { quiz } = (await response.json()) as { quiz: Quiz | null };
  const settled =
    quiz && quiz.questions?.length
      ? {
          ...quiz,
          // A v1 server still caching shapes without kinds must read as
          // "no quiz", not crash the runner mid-question
          questions: quiz.questions.filter((question) => question.kind).map(dealt),
        }
      : null;
  const usable = settled && settled.questions.length ? settled : null;
  cache.set(key, usable);
  return usable;
}

/** Tests only: module state must not leak between them. */
export function resetQuizCacheForTests() {
  cache.clear();
}
