/**
 * How far through the story the reader is, 0..1 — the violet bar
 * across the top of a story screen (Edd: "I liked that and I wonder
 * if we should bring it back"). Content that fits entirely on screen
 * reports 0: there is nothing to track, so the bar stays away.
 */
export function readingProgress(
  offsetY: number,
  contentHeight: number,
  viewportHeight: number
): number {
  const scrollable = contentHeight - viewportHeight;
  if (scrollable <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, offsetY / scrollable));
}
