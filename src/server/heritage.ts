import { HistoryItem } from '@/types/history';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * The heritage layer: Historic England's National Heritage List and
 * Open Plaques, both keyless and free. Where a listed building or a
 * plaque is clearly the same place as a Wikipedia story, it enriches
 * that story's badge instead of echoing it as a second card.
 */

const NhleBase =
  'https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/' +
  'National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer';

// Synthetic pageId namespaces, far above real Wikipedia pageids
const ListedBuildingIdBase = 2_000_000_000;
const PlaqueIdBase = 3_000_000_000;

/** ~meters → degrees at this latitude, for bounding boxes. */
function boxAround(center: Coordinates, radiusMeters: number) {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    south: center.latitude - latDelta,
    north: center.latitude + latDelta,
    west: center.longitude - lngDelta,
    east: center.longitude + lngDelta,
  };
}

/** NHLE names arrive ALL CAPS — "CHURCH OF ST ALFEGE" reads as shouting. */
const SmallWords = new Set(['and', 'of', 'the', 'at', 'to', 'in', 'on', 'with']);
export function titleCaseName(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && SmallWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(' ');
}

type NhleFeature = {
  attributes: { Name?: string; Grade?: string; ListEntry?: number };
  // Multipoint geometry: points[0] is [longitude, latitude] — NOT {x, y}
  geometry?: { points?: [number, number][] };
};

/** Pure and unit-tested against a recorded live response. */
export function buildListedBuildingItems(
  features: NhleFeature[],
  center: Coordinates
): HistoryItem[] {
  return features.flatMap((feature) => {
    const { Name, Grade, ListEntry } = feature.attributes;
    const point = feature.geometry?.points?.[0];
    if (!Name || !ListEntry || !point) {
      return [];
    }
    const coordinates = { latitude: point[1], longitude: point[0] };
    return [
      {
        pageId: ListedBuildingIdBase + ListEntry,
        title: titleCaseName(Name),
        coordinates,
        distanceMeters: distanceMeters(center, coordinates),
        extract: `Grade ${Grade ?? 'II'} listed building on the National Heritage List for England.`,
        url: `https://historicengland.org.uk/listing/the-list/list-entry/${ListEntry}`,
        source: `Historic England · Grade ${Grade ?? 'II'}`,
      },
    ];
  });
}

export async function fetchListedBuildings(
  center: Coordinates,
  radius = 1000
): Promise<HistoryItem[]> {
  const box = boxAround(center, radius);
  const geometry = JSON.stringify({
    xmin: box.west,
    ymin: box.south,
    xmax: box.east,
    ymax: box.north,
    spatialReference: { wkid: 4326 },
  });
  const params = new URLSearchParams({
    geometry,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'Name,Grade,ListEntry',
    returnGeometry: 'true',
    // No spatial ordering exists server-side, and dense areas hold far
    // more listed buildings than any small cap — a low cap returns an
    // ARBITRARY subset (measured: it dropped the Grade I Cutty Sark
    // while keeping Grade II houses). Fetch the area, sort by distance
    // ourselves; the merge cap keeps the list small.
    resultRecordCount: '500',
    f: 'json',
  });
  const response = await fetch(`${NhleBase}/0/query?${params}`);
  if (!response.ok) {
    throw new Error(`NHLE query failed with status ${response.status}`);
  }
  const body = (await response.json()) as { features?: NhleFeature[] };
  return buildListedBuildingItems(body.features ?? [], center);
}

type Plaque = {
  id: number;
  latitude?: number;
  longitude?: number;
  inscription?: string;
};

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** A readable card title from an inscription: first 60 chars, whole words. */
export function plaqueTitle(inscription: string): string {
  const clean = collapse(inscription);
  if (clean.length <= 60) {
    return clean;
  }
  const cut = clean.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(' '))}…`;
}

/** Pure and unit-tested against a recorded live response. */
export function buildPlaqueItems(plaques: Plaque[], center: Coordinates): HistoryItem[] {
  return plaques.flatMap((plaque) => {
    if (!plaque.inscription || plaque.latitude == null || plaque.longitude == null) {
      return [];
    }
    const coordinates = { latitude: plaque.latitude, longitude: plaque.longitude };
    return [
      {
        pageId: PlaqueIdBase + plaque.id,
        title: plaqueTitle(plaque.inscription),
        coordinates,
        distanceMeters: distanceMeters(center, coordinates),
        extract: collapse(plaque.inscription),
        url: `https://openplaques.org/plaques/${plaque.id}`,
        source: 'Open Plaques',
      },
    ];
  });
}

export async function fetchPlaques(center: Coordinates, radius = 1000): Promise<HistoryItem[]> {
  const box = boxAround(center, radius);
  // box=[north,west],[south,east] — verified live 2026-07-20
  const url =
    'https://openplaques.org/plaques.json' +
    `?box=[${box.north},${box.west}],[${box.south},${box.east}]`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Open Plaques query failed with status ${response.status}`);
  }
  return buildPlaqueItems((await response.json()) as Plaque[], center);
}

/** Same-place test: close by, and sharing a meaningful part of the name. */
const NoiseTokens = new Set(['the', 'a', 'an', 'of', 'and', 'at', 'church', 'house', 'building']);
function nameTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 1 && !NoiseTokens.has(word))
  );
}

function samePlace(a: HistoryItem, b: HistoryItem, maxMeters: number): boolean {
  if (distanceMeters(a.coordinates, b.coordinates) > maxMeters) {
    return false;
  }
  const aTokens = nameTokens(a.title);
  const bTokens = nameTokens(`${b.title} ${b.extract ?? ''}`);
  const shared = [...aTokens].filter((token) => bTokens.has(token)).length;
  return shared >= 2 || (aTokens.size > 0 && [...aTokens].every((token) => bTokens.has(token)));
}

/**
 * One place, one card: a heritage record that matches a Wikipedia
 * story enriches its badge ("Wikipedia · Grade I listed"); the rest
 * stand as their own stories. Wikipedia wins because its extract can
 * be told.
 */
export function mergeHistorySources(
  wikipedia: HistoryItem[],
  listed: HistoryItem[],
  plaques: HistoryItem[],
  cap = 40
): HistoryItem[] {
  const enriched = wikipedia.map((item) => ({ ...item }));

  // Any grade may enrich a story's badge, but only the notable grades
  // (I and II*, ~8% of the register) earn standalone cards — a feed of
  // anonymous Grade II terraces is the station-articles problem again
  const notableGrade = /Grade (I|II\*)$/;
  const standaloneListed = listed.filter((building) => {
    const match = enriched.find((story) => samePlace(story, building, 100));
    if (match) {
      const grade = building.source.split(' · ')[1] ?? 'listed';
      match.source = `${match.source} · ${grade} listed`;
      return false;
    }
    return notableGrade.test(building.source);
  });

  const standalonePlaques = plaques.filter((plaque) => {
    const match = enriched.find((story) => samePlace(story, plaque, 75));
    if (match) {
      match.source = `${match.source} · plaque`;
      return false;
    }
    return true;
  });

  return [...enriched, ...standaloneListed, ...standalonePlaques]
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, cap);
}
