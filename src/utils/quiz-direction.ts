import { HistoryItem } from '@/types/history';
import { bearingDegrees, Coordinates, distanceMeters } from '@/utils/geo';

/**
 * The pointing question: which way is that place?
 *
 * Alone among the quiz's questions this one is DERIVED, not written. We
 * know where the reader is standing and where the place is, so the
 * answer is arithmetic — no model, no source text, no free-tier call, and
 * nothing that can be hallucinated. It also means it survives everything
 * the generated questions do not: a thin area, an exhausted quota, a
 * failed parse.
 *
 * It is the only question that asks the DEVICE for something. Answering
 * it means turning your body until the phone agrees, which is the one
 * thing in this app that a web page could not put in front of a reader.
 */

/** Within this much counts. Roughly a compass point either side — wide
 *  enough for a person turning on a pavement, narrow enough to mean it. */
export const DirectionToleranceDegrees = 30;

/** Below this, pointing is meaningless: you are basically on top of it,
 *  and the bearing between two nearly identical points is noise. */
export const MinPointableMeters = 100;

export type DirectionQuestion = {
  pageId: number;
  title: string;
  /** True bearing from the reader to the place, degrees clockwise of north. */
  bearing: number;
  /** Recomputed from the live fix — never the feed's compose-time value. */
  distanceMeters: number;
};

/**
 * How wrong a guess was, in degrees, 0–180. Wraparound-safe: facing 350°
 * at a bearing of 10° is 20° out, not 340°.
 */
export function headingError(heading: number, bearing: number): number {
  const raw = (((heading - bearing) % 360) + 360) % 360;
  return raw > 180 ? 360 - raw : raw;
}

/** Did that guess land? */
export function pointedCorrectly(heading: number, bearing: number): boolean {
  return headingError(heading, bearing) <= DirectionToleranceDegrees;
}

/**
 * The place worth pointing at: the nearest one far enough away for the
 * question to mean something. Nearest rather than furthest because a
 * place a few minutes off is one the reader has a chance of placing;
 * something across the borough is a coin toss.
 *
 * Distances are recomputed from the live fix — the feed's own
 * distanceMeters was measured wherever the reader stood when it loaded.
 */
export function pointableStory(
  items: HistoryItem[],
  from: Coordinates
): DirectionQuestion | null {
  let best: DirectionQuestion | null = null;
  for (const item of items) {
    const metres = distanceMeters(from, item.coordinates);
    if (metres < MinPointableMeters) {
      continue;
    }
    if (!best || metres < best.distanceMeters) {
      best = {
        pageId: item.pageId,
        title: item.title,
        bearing: bearingDegrees(from, item.coordinates),
        distanceMeters: metres,
      };
    }
  }
  return best;
}
