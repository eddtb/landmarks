import { HistoryItem } from '@/types/history';

/**
 * The featured rail: mini listings at the top of Nearby (Edd's call —
 * the fun-facts FORMAT, but the content is places). Featured means the
 * heavy hitters, not merely the closest: a Historic England grade
 * outranks everything (Grade I > II* > II/listed), and the richness of
 * the story breaks ties. Only visitable things qualify — a photo to
 * recognise it by, no evidence of pastness — and the standing-on-it
 * item is never double-featured.
 */

function gradeRank(source: string): number {
  if (/Grade I(?!I)/.test(source)) return 3;
  if (source.includes('Grade II*')) return 2;
  if (source.includes('Grade II') || source.includes('listed')) return 1;
  return 0;
}

export function featuredStories(
  items: HistoryItem[],
  excludePageId?: number,
  max = 6
): HistoryItem[] {
  return items
    .filter(
      (item) => item.thumbnailUrl && !item.pastTag && item.pageId !== excludePageId
    )
    .sort(
      (a, b) =>
        gradeRank(b.source) - gradeRank(a.source) ||
        (b.extract?.length ?? 0) - (a.extract?.length ?? 0)
    )
    .slice(0, max);
}
