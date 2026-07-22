/**
 * The retold story's shape, defined once for both sides of the wire:
 * src/server/retold.ts writes and validates it, src/data/
 * retold-client.ts consumes it. One truth per shape.
 */

export type RetoldPart = { heading: string; body: string; pullQuote?: string };

export type TimelineStop = { year: string; label: string; part: number };

export type Retold = { parts: RetoldPart[]; minutes: number; timeline: TimelineStop[] };
