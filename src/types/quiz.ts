/**
 * The area quiz's shape, defined once for both sides of the wire:
 * src/server/quiz.ts writes and validates it, src/data/quiz-client.ts
 * consumes it. One truth per shape.
 *
 * v2: questions carry a `kind`. The old single-shape quizzes live under
 * the v1 cache keys and are never served to this client — the server's
 * key prefix moved with the shape (see quizKey).
 */

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
