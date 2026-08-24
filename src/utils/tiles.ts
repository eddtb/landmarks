import type { Coordinates } from './geo';

/**
 * The precompute grid: plain 0.05° lat/lng cells (~5.6 km tall, ~3.5 km
 * wide at UK latitudes). The bake writes one JSON file per cell holding
 * that cell's pre-composed stories; the client fetches every cell its
 * walk radius touches and merges them. Both sides MUST bin through the
 * same functions here — a story baked into one cell and looked up in
 * another is a story that vanished.
 *
 * Keys are "<south>,<west>" of the cell at two decimals: "51.45,-0.05".
 *
 * This module is shared by the app (Metro) and the bake scripts (plain
 * `node`, which strips types but resolves no path aliases) — so it may
 * only ever import types, never runtime values.
 */
export const TileSizeDegrees = 0.05;

export const TileVersion = 'v1';

/**
 * floor(value / 0.05) with the quotient snapped to 6 decimals first:
 * 51.45 / 0.05 is 1028.999999… in floats, and a bare floor would file a
 * boundary point one cell south of where the bake filed the stories
 * standing on it.
 */
function cellIndex(value: number): number {
  return Math.floor(Number((value / TileSizeDegrees).toFixed(6)));
}

function keyOf(row: number, col: number): string {
  return `${(row * TileSizeDegrees).toFixed(2)},${(col * TileSizeDegrees).toFixed(2)}`;
}

/** The cell a point belongs to. */
export function tileKey(coordinates: Coordinates): string {
  return keyOf(cellIndex(coordinates.latitude), cellIndex(coordinates.longitude));
}

/**
 * Every cell a circle of `radiusMeters` around `center` can touch,
 * row-major. 1 tile for a mid-cell point at feed radius, up to 6 near a
 * cell corner at the 3 km sparse horizon — never a fixed 3×3 guess.
 * The longitude span divides by cos(lat), clamped so a pole-ish
 * coordinate cannot explode the loop; the UK never meets the clamp.
 */
export function tileKeysCovering(center: Coordinates, radiusMeters: number): string[] {
  const latSpan = radiusMeters / 111_320;
  const cosLat = Math.max(0.2, Math.cos((center.latitude * Math.PI) / 180));
  const lngSpan = radiusMeters / (111_320 * cosLat);

  const keys: string[] = [];
  const north = cellIndex(center.latitude + latSpan);
  const east = cellIndex(center.longitude + lngSpan);
  for (let row = cellIndex(center.latitude - latSpan); row <= north; row++) {
    for (let col = cellIndex(center.longitude - lngSpan); col <= east; col++) {
      keys.push(keyOf(row, col));
    }
  }
  return keys;
}

/**
 * One story as baked: a HistoryItem before the client adds what only it
 * knows — distanceMeters (viewer-relative) and source (constant
 * "Wikipedia" in v1, so it would be dead weight in ~250k stories).
 */
export type TileStory = {
  pageId: number;
  title: string;
  coordinates: Coordinates;
  extract?: string;
  thumbnailUrl?: string;
  url: string;
  /** Wikidata existence fact — "Demolished 1936", "Former hospital" —
   * or absent: honest silence (baked by scripts/bake/sweep-facts.ts). */
  pastTag?: string;
  /** The article is ABOUT an event — History archive, never Nearby. */
  event?: true;
  /** Broad-area article (History Gazetteer, never a Nearby card). */
  area?: true;
};

export type TileFile = {
  v: 1;
  cell: string;
  stories: TileStory[];
};
