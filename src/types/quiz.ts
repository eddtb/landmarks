/**
 * The area quiz's shape, defined once for both sides of the wire:
 * src/server/quiz.ts writes and validates it, src/data/quiz-client.ts
 * consumes it. One truth per shape.
 *
 * v2: questions carry a `kind`. The old single-shape quizzes live under
 * the v1 cache keys and are never served to this client — the server's
 * key prefix moved with the shape (see quizCacheKey).
 */

/**
 * The quiz cache's key: the AREA, and nothing else — ONE truth for both
 * sides of the wire (src/server/quiz.ts's 30-day store, src/data/
 * quiz-client.ts's session cache), so the device can never hit where the
 * server would have regenerated. It could before: the client digested
 * pageIds, the server digested pageId + title + extract.
 *
 * The stories a quiz is set from are MATERIAL, not identity, exactly as
 * the retold cache treats an area's article. Keying on them instead made
 * the cache follow the ~111m feed bucket rather than the area — the
 * nearest twelve change membership at nearly every crossing, so a 2km
 * walk with the tab open could spend ~18 of the shared 300 daily
 * free-tier calls re-setting one area's quiz (#280).
 *
 * What it costs: the twelve an area's quiz is set from are whichever
 * twelve the first asker in that area had, for 30 days — so someone at
 * the edge may be asked about places they are not nearest to. That is
 * the right trade: the quiz asks about the AREA (see quizPrompt), every
 * question carries its own title and citation from the server payload
 * rather than the reader's feed, and the one genuinely reader-relative
 * thing — the pointing finale — is derived on the device from where
 * they stand and was never in this cache. It also removes the
 * fabrication guard the digest was doubling as (#303).
 *
 * The version prefix retires every older slot at once when the CONTRACT
 * changes, not just the material: v2 added kinds (a cached quiz without
 * them is a broken screen); v3 changed the question register after the
 * first on-phone run served "how many men are on the memorial"; v4 is
 * this key, and orphans the bucket-keyed v3 entries rather than letting
 * them be misread.
 */
export function quizCacheKey(areaName: string): string {
  return `v4:${areaName.toLowerCase()}`;
}

type QuizQuestionBase = {
  /** The story this was set from — the citation, and the tap target. */
  pageId: number;
  /** That story's title, taken from OUR record rather than the model's,
   *  so a citation can never drift from the thing it cites. */
  title: string;
  /** The fact itself, shown once answered — the point of the question. */
  because: string;
};

/** The sharpened original: the one concrete surprise in a story. */
export type AnchorQuestion = QuizQuestionBase & {
  kind: 'anchor';
  question: string;
  /** Exactly four, unique, one of them right. */
  options: string[];
  answerIndex: number;
};

/**
 * The fact is given; the place is the question. All four options are
 * titles of stories WE supplied — the right one is the cited story, the
 * three distractors are named by pageId and titled from our record, so
 * every wrong answer is a real place nearby.
 */
export type WhichPlaceQuestion = QuizQuestionBase & {
  kind: 'which-place';
  question: string;
  options: string[];
  answerIndex: number;
};

export type OrderItem = { pageId: number; title: string; year: number };

/**
 * Three places, put into the order they arrived on this ground. The
 * wire carries them in the CORRECT order, oldest first — the client
 * shuffles the presentation, exactly as it deals option order. Every
 * item's year must be stated in its own story's source text or the
 * question is dropped whole.
 */
export type OrderQuestion = QuizQuestionBase & {
  kind: 'order';
  question: string;
  items: OrderItem[];
};

/**
 * One statement, true or myth. A false statement is a plausible
 * misreading of the source, and `because` gives the true fact either
 * way — the correction is the reward.
 */
export type TrueFalseQuestion = QuizQuestionBase & {
  kind: 'true-false';
  statement: string;
  answer: boolean;
};

export type QuizQuestion =
  | AnchorQuestion
  | WhichPlaceQuestion
  | OrderQuestion
  | TrueFalseQuestion;

export type Quiz = { areaName: string; questions: QuizQuestion[] };
