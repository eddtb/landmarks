import { Place, PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Server-side only: everything in this module runs inside API routes,
 * never in the app bundle. The Places API key must not leak past here.
 */

// Two endpoints, two jobs. Nearby Search ranks strictly by distance but
// cannot paginate (20 max); Text Search paginates (60 max) but its
// "DISTANCE" ranking still mixes in relevance, so its first page can miss
// the truly nearest places. The first page merges both; later pages come
// from Text Search tokens.
const TextSearchEndpoint = 'https://places.googleapis.com/v1/places:searchText';
const NearbySearchEndpoint = 'https://places.googleapis.com/v1/places:searchNearby';

/** Search phrasing per section — Text Search takes a query, not type lists. */
const CategoryQueries: Record<PlaceCategory, string> = {
  landmark: 'tourist attractions, landmarks and museums',
  restaurant: 'restaurants and cafes',
  pub: 'pubs and bars',
};

/** Place types per section — Nearby Search "Table A" types. */
const CategoryTypes: Record<PlaceCategory, string[]> = {
  landmark: ['tourist_attraction', 'museum', 'historical_landmark', 'art_gallery', 'park'],
  restaurant: ['restaurant', 'cafe'],
  pub: ['pub', 'bar'],
};

/** Only the fields we map — the field mask also controls Google billing tier. */
const PlaceFieldMask = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.formattedAddress',
  'places.websiteUri',
  'places.currentOpeningHours.openNow',
  'places.photos.name',
].join(',');

// Nearby Search rejects mask fields it can't return, so nextPageToken
// may only be requested from Text Search.
const TextSearchFieldMask = `nextPageToken,${PlaceFieldMask}`;

export const DefaultRadiusMeters = 1500;

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  formattedAddress?: string;
  websiteUri?: string;
  currentOpeningHours?: { openNow?: boolean };
  photos?: { name: string }[];
};

export function mapGooglePlace(
  googlePlace: GooglePlace,
  category: PlaceCategory,
  origin: string,
  userLocation: Coordinates
): PlaceWithDistance | null {
  const { latitude, longitude } = googlePlace.location ?? {};
  const name = googlePlace.displayName?.text;
  if (!name || latitude === undefined || longitude === undefined) {
    return null;
  }

  const photoName = googlePlace.photos?.[0]?.name;
  const website = googlePlace.websiteUri;
  const openNow = googlePlace.currentOpeningHours?.openNow;

  const place: Place = {
    id: googlePlace.id,
    name,
    category,
    coordinates: { latitude, longitude },
    rating: googlePlace.rating ?? 0,
    photoUrl: photoName
      ? `${origin}/api/photo?name=${encodeURIComponent(photoName)}`
      : `https://picsum.photos/seed/${encodeURIComponent(googlePlace.id)}/800/500`,
    address: googlePlace.formattedAddress ?? '',
    hours: openNow === undefined ? undefined : openNow ? 'Open now' : 'Closed now',
    website: website?.startsWith('https://') ? (website as `https://${string}`) : undefined,
  };

  return { ...place, distanceMeters: distanceMeters(userLocation, place.coordinates) };
}

export type SearchPage = {
  places: PlaceWithDistance[];
  nextPageToken?: string;
};

/** Dedupe by id (first occurrence wins) and sort nearest first. */
export function dedupeAndSortByDistance(...lists: PlaceWithDistance[][]): PlaceWithDistance[] {
  const seen = new Set<string>();
  const merged: PlaceWithDistance[] = [];
  for (const place of lists.flat()) {
    if (!seen.has(place.id)) {
      seen.add(place.id);
      merged.push(place);
    }
  }
  return merged.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

type SearchContext = {
  apiKey: string;
  category: PlaceCategory;
  center: Coordinates;
  radius: number;
  origin: string;
};

async function callPlacesApi(
  endpoint: string,
  apiKey: string,
  fieldMask: string,
  body: object
): Promise<{ places?: GooglePlace[]; nextPageToken?: string }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places API ${response.status}: ${detail.slice(0, 500)}`);
  }

  return (await response.json()) as { places?: GooglePlace[]; nextPageToken?: string };
}

function mapAll(body: { places?: GooglePlace[] }, context: SearchContext): PlaceWithDistance[] {
  return (body.places ?? [])
    .map((googlePlace) =>
      mapGooglePlace(googlePlace, context.category, context.origin, context.center)
    )
    .filter((place): place is PlaceWithDistance => place !== null);
}

/** Paginated Text Search — relevance-tinted even with DISTANCE ranking. */
async function textSearchPage(context: SearchContext, pageToken?: string): Promise<SearchPage> {
  const body = await callPlacesApi(TextSearchEndpoint, context.apiKey, TextSearchFieldMask, {
    textQuery: CategoryQueries[context.category],
    pageSize: 20,
    rankPreference: 'DISTANCE',
    locationBias: {
      circle: { center: context.center, radius: context.radius },
    },
    ...(pageToken ? { pageToken } : {}),
  });
  return {
    places: dedupeAndSortByDistance(mapAll(body, context)),
    nextPageToken: body.nextPageToken,
  };
}

/** Strictly-nearest 20 — Nearby Search cannot paginate but never misses close places. */
async function nearestTwenty(context: SearchContext): Promise<PlaceWithDistance[]> {
  const body = await callPlacesApi(NearbySearchEndpoint, context.apiKey, PlaceFieldMask, {
    includedTypes: CategoryTypes[context.category],
    maxResultCount: 20,
    rankPreference: 'DISTANCE',
    locationRestriction: {
      circle: { center: context.center, radius: context.radius },
    },
  });
  return mapAll(body, context);
}

export async function searchNearby(options: {
  apiKey: string;
  category: PlaceCategory;
  center: Coordinates;
  radius?: number;
  /** Origin of the incoming request, used to build photo-proxy URLs. */
  origin: string;
  /** Token from a previous page; all other options must be unchanged. */
  pageToken?: string;
}): Promise<SearchPage> {
  const { radius = DefaultRadiusMeters, pageToken, ...rest } = options;
  const context: SearchContext = { ...rest, radius };

  // Later pages: Text Search token only (the client merges and re-sorts).
  if (pageToken) {
    return textSearchPage(context, pageToken);
  }

  // First page: guarantee the truly nearest places (Nearby Search) while
  // also starting Text Search pagination for the infinite scroll.
  const [nearest, textPage] = await Promise.all([
    nearestTwenty(context),
    textSearchPage(context),
  ]);

  return {
    places: dedupeAndSortByDistance(nearest, textPage.places),
    nextPageToken: textPage.nextPageToken,
  };
}
