/**
 * Bake stage 3: coordinates + swept pages → one JSON file per 0.05°
 * grid cell, ready for GitHub Pages.
 *
 *   node scripts/bake/write-tiles.ts [--coords .bake/uk-pages.ndjson]
 *     [--pages .bake/pages.ndjson] [--out .bake/tiles]
 *
 * Applies the same noise-title gate the live compose applies, bins
 * through the same tileKey the client will look up with, and caps a
 * cell at 200 stories — the live geosearch's own cap — preferring
 * illustrated, substantial articles when a dense city cell overflows.
 * Writes <out>/v1/<cell>.json plus a manifest with the bake's stats.
 */
import fs from 'node:fs';
import path from 'node:path';

import { isStoryTitle } from '../../src/utils/story-title.ts';
import type { TileFile, TileStory } from '../../src/utils/tiles.ts';
import { tileKey, TileVersion } from '../../src/utils/tiles.ts';

function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const coordsPath = flag('coords', '.bake/uk-pages.ndjson');
const pagesPath = flag('pages', '.bake/pages.ndjson');
const factsPath = flag('facts', '.bake/facts.ndjson');
const outDir = flag('out', '.bake/tiles');

const MaxStoriesPerTile = 200;

function readLines<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

const coords = new Map(
  readLines<{ p: number; lat: number; lng: number }>(coordsPath).map((c) => [c.p, c])
);

// Existence verdicts, keyed by title. Optional input but never silently
// so: a bake without facts ships events into Nearby and strips every
// pastTag, and the manifest + log both say it happened.
type Fact = { title: string; tag?: string; event?: true; area?: true };
const facts = fs.existsSync(factsPath)
  ? new Map(readLines<Fact>(factsPath).map((fact) => [fact.title, fact]))
  : null;
if (!facts) {
  console.warn(
    `[tiles] WARNING: no facts file at ${factsPath} — baking WITHOUT existence tags or event verdicts`
  );
}

type SweptPage = Omit<TileStory, 'coordinates'>;

const tiles = new Map<string, TileStory[]>();
let swept = 0;
let gated = 0;
const placed = new Set<number>();

for (const page of readLines<SweptPage>(pagesPath)) {
  swept++;
  const at = coords.get(page.pageId);
  if (!at || placed.has(page.pageId)) {
    continue; // resumed sweeps can append a chunk twice; first one wins
  }
  if (!isStoryTitle(page.title)) {
    gated++;
    continue;
  }
  placed.add(page.pageId);
  const fact = facts?.get(page.title);
  const story: TileStory = {
    pageId: page.pageId,
    title: page.title,
    coordinates: { latitude: at.lat, longitude: at.lng },
    ...(page.extract ? { extract: page.extract } : {}),
    ...(page.thumbnailUrl ? { thumbnailUrl: page.thumbnailUrl } : {}),
    url: page.url,
    ...(fact?.tag ? { pastTag: fact.tag } : {}),
    ...(fact?.event ? { event: true as const } : {}),
    // Two area signals, either wins: the London category gate from the
    // extract sweep, and Wikidata's district/town classes from facts
    ...(page.area || fact?.area ? { area: true as const } : {}),
  };
  const cell = tileKey(story.coordinates);
  const bucket = tiles.get(cell);
  if (bucket) {
    bucket.push(story);
  } else {
    tiles.set(cell, [story]);
  }
}

// When a dense cell overflows, keep the stories a card can carry:
// photo and extract first, then the longest tellings' source material
function weight(story: TileStory): number {
  return (story.thumbnailUrl ? 2 : 0) + (story.extract ? 1 : 0);
}

const versionDir = path.join(outDir, TileVersion);
fs.rmSync(versionDir, { recursive: true, force: true });
fs.mkdirSync(versionDir, { recursive: true });

let bytes = 0;
let kept = 0;
let cappedTiles = 0;
const sizes: { cell: string; count: number }[] = [];

for (const [cell, stories] of tiles) {
  if (stories.length > MaxStoriesPerTile) {
    cappedTiles++;
    stories.sort(
      (a, b) => weight(b) - weight(a) || (b.extract?.length ?? 0) - (a.extract?.length ?? 0)
    );
    stories.length = MaxStoriesPerTile;
  }
  const file: TileFile = { v: 1, cell, stories };
  const json = JSON.stringify(file);
  fs.writeFileSync(path.join(versionDir, `${cell}.json`), json);
  bytes += json.length;
  kept += stories.length;
  sizes.push({ cell, count: stories.length });
}

sizes.sort((a, b) => b.count - a.count);
const manifest = {
  generatedAt: new Date().toISOString(),
  tileVersion: TileVersion,
  tiles: tiles.size,
  stories: kept,
  sweptPages: swept,
  gatedTitles: gated,
  cappedTiles,
  bytes,
  largest: sizes.slice(0, 5),
};
fs.writeFileSync(path.join(versionDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(
  `[tiles] ${tiles.size} tiles, ${kept} stories (${gated} noise-gated, ${cappedTiles} capped), ` +
    `${(bytes / 1e6).toFixed(1)} MB raw → ${versionDir}`
);
