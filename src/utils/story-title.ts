/**
 * Register gate: geosearch mixes genuine stories (vanished palaces,
 * a nuclear reactor in the Naval College) with infrastructure that
 * merely has an article — stations, plain streets, piers. Those read
 * identically in a list and dilute the treasure, so they're gated by
 * title pattern — the same spirit as the venue lists' two-photo rule.
 * (Measured near Greenwich: 20 items → 4 gated, all noise.)
 *
 * Lives here, import-free, because the tile bake (plain `node`, no
 * path aliases) applies the same gate at publish time that the live
 * compose applies at request time — one gate, not two drifting copies.
 */
const NoiseTitlePatterns = [
  / stations?$/i, // "Cutty Sark for Maritime Greenwich DLR station"
  / (Street|Road|Walk|Lane|Avenue|Approach|Roundabout)$/, // plain street articles
  / Pier$/,
];

export function isStoryTitle(title: string): boolean {
  return !NoiseTitlePatterns.some((pattern) => pattern.test(title));
}

/** The batch request asks only for categories that positively identify
 * broad London areas; buildings in those areas do not carry them.
 * Shared here for the same reason as the gate above: the bake asks the
 * identical question at publish time. */
export const BroadAreaCategories = [
  'Category:Areas of London',
  'Category:District centres of London',
  'Category:Districts of London on the River Thames',
];
