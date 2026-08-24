import { fetch } from 'expo/fetch';

import { ApiError } from '@/data/cached-get';
import { HistoryFeed, HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';
import type { TileFile, TileStory } from '@/utils/tiles';
import { tileKeysCovering, TileVersion } from '@/utils/tiles';

/**
 * The baked ground: pre-composed story tiles on a static host
 * (scripts/bake writes them, a public GitHub Pages repo serves them).
 * Reading the feed is fetching the handful of ~0.05° cells the walk
 * radius touches and merging on device — no worker, no compose, no
 * upstream fan-out. The env override points dev clients at a local
 * bake output.
 */
const TilesBaseUrl = process.env.EXPO_PUBLIC_TILES_URL ?? 'https://eddtb.github.io/venture-tiles';

// The live compose's own numbers, mirrored (src/server/sparse.ts, the
// geosearch radius in src/app/api/history+api.ts, the deep-feed cap):
// tiles change where stories come FROM, not what a feed IS.
const FeedRadiusMeters = 1500;
const SparseHorizonMeters = 3000;
const SparseThreshold = 25;
const FeedCap = 150;

function tileUrl(cell: string): string {
  return `${TilesBaseUrl}/${TileVersion}/${cell}.json`;
}

/** The store's pulse: the bake always writes a manifest beside the
 * tiles, so its absence means the store itself is absent. Probed per
 * ask (the device HTTP cache makes repeats ~free), never memoized — a
 * store that was missing a minute ago may have just been published. */
async function ensureStore(): Promise<void> {
  const response = await fetch(`${TilesBaseUrl}/${TileVersion}/manifest.json`);
  if (!response.ok) {
    throw new ApiError('History', response.status);
  }
}

/**
 * One cell's stories. A 404 is a real answer — empty cells are never
 * written, most of the sea and much of the Highlands among them — and
 * yields nothing. Any other failure throws: a feed must not quietly
 * assemble from half its ground (#291's lesson — the caller's offline
 * fallback needs a throw to know to step in).
 */
async function fetchTile(cell: string): Promise<TileStory[]> {
  const response = await fetch(tileUrl(cell));
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new ApiError('History', response.status);
  }
  const tile = (await response.json()) as TileFile;
  return tile.stories;
}

/**
 * The feed, read from the baked ground: fetch the covering cells,
 * merge, measure, sort nearest-first, cap — and when a quiet corner
 * holds fewer than the sparse threshold, widen to the 3 km horizon
 * exactly as the server compose did, fetching only the cells the first
 * ring didn't already bring in.
 */
export async function fetchTileFeed(center: Coordinates): Promise<HistoryFeed> {
  const nearKeys = tileKeysCovering(center, FeedRadiusMeters);
  // The manifest probe rides beside the cell fetches at zero latency
  // cost and settles the one ambiguity 404s leave: with it, a missing
  // cell is honest emptiness; without it, the whole store is absent
  // (not yet published, moved, a bad deploy) and the read must THROW
  // so the caller's fallback road takes over — all-404s must never
  // dress up as a quiet corner of the Highlands.
  const [pairs] = await Promise.all([
    Promise.all(
      nearKeys.map(async (cell): Promise<[string, TileStory[]]> => [cell, await fetchTile(cell)])
    ),
    ensureStore(),
  ]);
  const fetched = new Map(pairs);

  const near = assemble(fetched, center, FeedRadiusMeters);
  if (near.length >= SparseThreshold) {
    return { items: near.slice(0, FeedCap) };
  }

  const farKeys = tileKeysCovering(center, SparseHorizonMeters).filter((cell) => !fetched.has(cell));
  for (const [cell, stories] of await Promise.all(
    farKeys.map(async (cell): Promise<[string, TileStory[]]> => [cell, await fetchTile(cell)])
  )) {
    fetched.set(cell, stories);
  }

  return {
    items: assemble(fetched, center, SparseHorizonMeters).slice(0, FeedCap),
    sparse: true,
    horizon: SparseHorizonMeters,
  };
}

/** Merge fetched cells into feed items: viewer distance on, tile-only
 * shape off, stories beyond the radius out (a cell is bigger than the
 * walk), nearest first. */
function assemble(
  fetched: Map<string, TileStory[]>,
  center: Coordinates,
  radiusMeters: number
): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const stories of fetched.values()) {
    for (const story of stories) {
      const distance = distanceMeters(center, story.coordinates);
      if (distance <= radiusMeters) {
        items.push({ ...story, distanceMeters: distance, source: 'Wikipedia' });
      }
    }
  }
  return items.sort((a, b) => a.distanceMeters - b.distanceMeters);
}
