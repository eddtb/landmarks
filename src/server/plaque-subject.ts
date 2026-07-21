import { diskBackedMap } from '@/server/ai-cache';
import { findStory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';

/**
 * A plaque's "title" is its inscription — "Deptford Creek. This is
 * the mouth of the River…" — so plaque stories never found their
 * Wikipedia article and never earned the Gazetteer (Edd's report).
 *
 * Evidence-gated resolution (Edd's pick, option A): geosearch within
 * 250m of the plaque itself and accept only a name-matched article
 * (findStory's gate — the subject must be physically AT the plaque
 * and named IN the inscription). A confident match retitles the item
 * and lends its photo; anything less keeps the honest inscription.
 * Resolutions — including misses — cache for 30 days per plaque.
 */

const TtlMs = 30 * 24 * 60 * 60 * 1000;
type Resolution = { title: string; thumbnailUrl?: string } | null;
// v2: v1 was poisoned by rate-limited lookups cached as "no subject"
const cache = diskBackedMap<{ resolution: Resolution; at: number }>('plaque-subjects-v2');

const normalize = (text: string) => text.toLowerCase().replace(/['’]/g, '').trim();

/** Pure and unit-tested: apply a resolution unless it duplicates the feed. */
export function applyResolution(
  item: HistoryItem,
  resolution: Resolution,
  takenTitles: Set<string>
): HistoryItem {
  if (!resolution) {
    return item;
  }
  if (takenTitles.has(normalize(resolution.title))) {
    // The feed already tells that story under its own card: no
    // duplicate — the card keeps the inscription, but the story
    // screen may open the subject's Gazetteer
    return { ...item, subject: resolution.title };
  }
  return {
    ...item,
    title: resolution.title,
    // The plaque's own photo (if any) still wins; the article's is backup
    thumbnailUrl: item.thumbnailUrl ?? resolution.thumbnailUrl,
    // The inscription stays: it is the primary source on the ground
  };
}

export async function resolvePlaqueSubjects(
  plaques: HistoryItem[],
  backbone: HistoryItem[]
): Promise<HistoryItem[]> {
  const takenTitles = new Set(backbone.map((item) => normalize(item.title)));

  // Sequential on purpose: 20 parallel lookups got the summary
  // endpoint rate-limited, and politeness is the price of keyless
  const resolved: HistoryItem[] = [];
  for (const item of plaques) {
    const key = String(item.pageId);
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < TtlMs) {
      resolved.push(applyResolution(item, cached.resolution, takenTitles));
      continue;
    }
    let resolution: Resolution = null;
    try {
      // The full inscription (extract), not the truncated card title
      const story = await findStory(item.extract ?? item.title, item.coordinates);
      resolution = story ? { title: story.title, thumbnailUrl: story.thumbnailUrl } : null;
      cache.set(key, { resolution, at: Date.now() });
    } catch {
      // Upstream wobble: degrade to the inscription, don't cache the miss
    }
    resolved.push(applyResolution(item, resolution, takenTitles));
  }
  return resolved;
}
