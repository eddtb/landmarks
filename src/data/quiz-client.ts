import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { Quiz } from '@/types/quiz';

/**
 * The quiz client: a session cache in front of one ask per area.
 *
 * A null quiz is cached exactly as a real one is — "no quiz for this
 * ground" is an answer, and re-asking it on every visit to the tab
 * would spend a free-tier call to be told the same thing.
 */

const cache = new Map<string, Quiz | null>();

export type QuizStory = { pageId: number; title: string; extract: string };

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
  const settled = quiz && quiz.questions?.length ? quiz : null;
  cache.set(key, settled);
  return settled;
}

/** Tests only: module state must not leak between them. */
export function resetQuizCacheForTests() {
  cache.clear();
}
