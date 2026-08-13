/**
 * The retold story's shape, defined once for both sides of the wire:
 * src/server/retold.ts writes and validates it, src/data/
 * retold-client.ts consumes it. One truth per shape.
 */

export type RetoldPart = { heading: string; body: string; pullQuote?: string };

export type TimelineStop = { year: string; label: string; part: number };

export type Retold = {
  parts: RetoldPart[];
  minutes: number;
  timeline: TimelineStop[];
  /** The 2-3 lines a stranger standing here most needs — the model
   *  chooses WHICH questions this place calls for (a ship is not a
   *  ruin). Empty when the model offered nothing that survived
   *  validation; the card simply doesn't render. */
  brief: string[];
};
