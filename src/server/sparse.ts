/**
 * Sparse-area mode: the app is tuned on Greenwich, one of England's
 * densest heritage areas, where a 1500m Wikipedia search fills the
 * feed. Dropped in a village, the same walk yields a thin, sad list.
 *
 * The product reasoning: the 19-minute-walk promise stands in dense
 * areas — nothing widens, nothing changes. In sparse areas we trade
 * distance for substance: Wikipedia (only) re-searches at the wide
 * horizon, heritage radii stay put, and the response says so honestly
 * with a `sparse` flag so the client can tell the user we looked
 * further.
 */

/** Below this many merged stories, the feed reads thin — widen. */
export const SparseStoryThreshold = 25;

/** The wide horizon: ~38 min at walking pace (1.33 m/s). */
export const SparseRadiusMeters = 3000;

/** The sparse decision, pure and pinned by tests. */
export function shouldWiden(storyCount: number): boolean {
  return storyCount < SparseStoryThreshold;
}
