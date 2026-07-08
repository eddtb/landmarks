import { Place, PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Server-side only: everything in this module runs inside API routes,
 * never in the app bundle. The Places API key must not leak past here.
 */

// Text Search (not Nearby Search): only Text Search supports pageToken
// pagination, which the infinite scroll needs. Capped by Google at 60
// results (3 pages of 20) per query.
const SearchEndpoint = 'https://places.googleapis.com/v1/places:searchText';

/** Search phrasing per section — Text Search takes a query, not type lists. */
const CategoryQueries: Record<PlaceCategory, string> = {
  landmark: 'tourist attractions, landmarks and museums',
  restaurant: 'restaurants and cafes',
  pub: 'pubs and bars',
};

/** Only the fields we map — the field mask also controls Google billing tier. */
const FieldMask = [
  'nextPageToken',
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.formattedAddress',
  'places.websiteUri',
  'places.currentOpeningHours.openNow',
  'places.photos.name',
].join(',');

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
  const { apiKey, category, center, radius = DefaultRadiusMeters, origin, pageToken } = options;

  const response = await fetch(SearchEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': FieldMask,
    },
    body: JSON.stringify({
      textQuery: CategoryQueries[category],
      pageSize: 20,
      // Nearest matches, not most relevant — the product is "what's closest
      // to me", so an unremarkable café 50m away beats a landmark 1.4km away.
      rankPreference: 'DISTANCE',
      locationBias: {
        circle: { center, radius },
      },
      ...(pageToken ? { pageToken } : {}),
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as { places?: GooglePlace[]; nextPageToken?: string };
  const places = (body.places ?? [])
    .map((googlePlace) => mapGooglePlace(googlePlace, category, origin, center))
    .filter((place): place is PlaceWithDistance => place !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);

  return { places, nextPageToken: body.nextPageToken };
}
