/**
 * The area quiz's shape, defined once for both sides of the wire:
 * src/server/quiz.ts writes and validates it, src/data/quiz-client.ts
 * consumes it. One truth per shape.
 */

export type QuizQuestion = {
  /** The story this was set from — the citation, and the tap target. */
  pageId: number;
  /** That story's title, taken from OUR record rather than the model's,
   *  so a citation can never drift from the thing it cites. */
  title: string;
  question: string;
  /** Exactly four, unique, one of them right. */
  options: string[];
  answerIndex: number;
  /** The fact itself, shown once answered — the point of the question. */
  because: string;
};

export type Quiz = { areaName: string; questions: QuizQuestion[] };
