import { Place, PlaceCategory, PlaceDetails, PlaceReview, PlaceWithDistance } from '@/types/place';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Server-side only: everything in this module runs inside API routes,
 * never in the app bundle. The Places API key must not leak past here.
 *
 * Two-tier fetching: the list search requests a lean field mask (users see
 * 20 cards but tap ~1), and the rich fields are fetched one place at a time
 * via Place Details. This keeps the per-search billing tier low and makes
 * the expensive fields affordable exactly where they're seen.
 *
 * Nearby Search ranks strictly by distance — the product is "the nearest
 * places, nearest first", one page of 20, no pagination. (Text Search
 * pagination was tried and removed: its DISTANCE ranking mixes in
 * relevance and its pages aren't distance-partitioned, which made the
 * list jump around as pages loaded.)
 */

const NearbySearchEndpoint = 'https://places.googleapis.com/v1/places:searchNearby';
const PlaceDetailsEndpoint = 'https://places.googleapis.com/v1/places';

/** Place types per section — Places API (New) "Table A" types. */
const CategoryTypes: Record<PlaceCategory, string[]> = {
  landmark: ['tourist_attraction', 'museum', 'historical_landmark', 'art_gallery', 'park'],
  restaurant: ['restaurant', 'cafe'],
  pub: ['pub', 'bar'],
};

/** Lean mask for the list — what a card shows, nothing more. */
const ListFieldMask = [
  'places.id',
  'places.displayName',
  'places.location',
  'places.rating',
  'places.userRatingCount',
  'places.photos.name',
  'routingSummaries',
].join(',');

/** Rich mask for one tapped place — Place Details uses top-level field names. */
const DetailsFieldMask = [
  'id',
  'displayName',
  'location',
  'types',
  'rating',
  'userRatingCount',
  'formattedAddress',
  'websiteUri',
  'currentOpeningHours.openNow',
  'regularOpeningHours.weekdayDescriptions',
  'photos.name',
  'editorialSummary',
  'nationalPhoneNumber',
  'googleMapsUri',
  'priceLevel',
  'reviews.rating',
  'reviews.text.text',
  'reviews.authorAttribution.displayName',
  'reviews.relativePublishTimeDescription',
].join(',');

export const DefaultRadiusMeters = 1500;
const MaxDetailPhotos = 6;

const PriceLevelSymbols: Record<string, string> = {
  PRICE_LEVEL_INEXPENSIVE: '£',
  PRICE_LEVEL_MODERATE: '££',
  PRICE_LEVEL_EXPENSIVE: '£££',
  PRICE_LEVEL_VERY_EXPENSIVE: '££££',
};

type GooglePlace = {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  rating?: number;
  formattedAddress?: string;
  websiteUri?: string;
  currentOpeningHours?: { openNow?: boolean };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  photos?: { name: string }[];
  editorialSummary?: { text?: string };
  userRatingCount?: number;
  nationalPhoneNumber?: string;
  googleMapsUri?: string;
  priceLevel?: string;
  reviews?: {
    rating?: number;
    text?: { text?: string };
    authorAttribution?: { displayName?: string };
    relativePublishTimeDescription?: string;
  }[];
};

const MaxReviews = 4;

type RoutingSummary = {
  legs?: { duration?: string; distanceMeters?: number }[];
  directionsUri?: string;
};

/** "73s" -> 73 */
function parseDurationSeconds(duration: string | undefined): number | undefined {
  if (!duration) {
    return undefined;
  }
  const seconds = Number(duration.replace(/s$/, ''));
  return Number.isFinite(seconds) ? seconds : undefined;
}

/**
 * routingSummaries is a parallel array to places — zip by index. Entries
 * can be missing or empty when Google has no walking route.
 */
export function applyRoutingSummaries(
  places: (PlaceWithDistance | null)[],
  summaries: RoutingSummary[] | undefined
): (PlaceWithDistance | null)[] {
  if (!summaries) {
    return places;
  }
  return places.map((place, index) => {
    const leg = summaries[index]?.legs?.[0];
    if (!place || !leg) {
      return place;
    }
    return {
      ...place,
      walkSeconds: parseDurationSeconds(leg.duration),
      walkMeters: leg.distanceMeters,
      walkingDirectionsUri: summaries[index]?.directionsUri,
    };
  });
}

function mapReviews(googleReviews: GooglePlace['reviews']): PlaceReview[] | undefined {
  const reviews = (googleReviews ?? [])
    .filter((review) => !!review.text?.text && !!review.authorAttribution?.displayName)
    .slice(0, MaxReviews)
    .map((review) => ({
      author: review.authorAttribution!.displayName!,
      rating: review.rating,
      text: review.text!.text!,
      when: review.relativePublishTimeDescription,
    }));
  return reviews.length > 0 ? reviews : undefined;
}

function photoProxyUrl(photoName: string, origin: string): string {
  return `${origin}/api/photo?name=${encodeURIComponent(photoName)}`;
}

function placeholderPhotoUrl(id: string): string {
  return `https://picsum.photos/seed/${encodeURIComponent(id)}/800/500`;
}

/** Details responses carry Google types, not our section — infer ours. */
export function categoryFromTypes(types: string[] | undefined): PlaceCategory {
  const typeSet = new Set(types ?? []);
  if (CategoryTypes.pub.some((type) => typeSet.has(type))) {
    return 'pub';
  }
  if (CategoryTypes.restaurant.some((type) => typeSet.has(type))) {
    return 'restaurant';
  }
  return 'landmark';
}

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

  const place: Place = {
    id: googlePlace.id,
    name,
    category,
    coordinates: { latitude, longitude },
    rating: googlePlace.rating ?? 0,
    photoUrl: photoName
      ? photoProxyUrl(photoName, origin)
      : placeholderPhotoUrl(googlePlace.id),
    address: googlePlace.formattedAddress ?? '',
    ratingCount: googlePlace.userRatingCount,
  };

  return { ...place, distanceMeters: distanceMeters(userLocation, place.coordinates) };
}

export function mapGooglePlaceDetails(
  googlePlace: GooglePlace,
  origin: string
): PlaceDetails | null {
  const { latitude, longitude } = googlePlace.location ?? {};
  const name = googlePlace.displayName?.text;
  if (!name || latitude === undefined || longitude === undefined) {
    return null;
  }

  const website = googlePlace.websiteUri;
  const openNow = googlePlace.currentOpeningHours?.openNow;
  const photoUrls = (googlePlace.photos ?? [])
    .slice(0, MaxDetailPhotos)
    .map((photo) => photoProxyUrl(photo.name, origin));

  return {
    id: googlePlace.id,
    name,
    category: categoryFromTypes(googlePlace.types),
    coordinates: { latitude, longitude },
    rating: googlePlace.rating ?? 0,
    ratingCount: googlePlace.userRatingCount,
    photoUrl: photoUrls[0] ?? placeholderPhotoUrl(googlePlace.id),
    photoUrls: photoUrls.length > 0 ? photoUrls : [placeholderPhotoUrl(googlePlace.id)],
    address: googlePlace.formattedAddress ?? '',
    hours: openNow === undefined ? undefined : openNow ? 'Open now' : 'Closed now',
    weekdayHours: googlePlace.regularOpeningHours?.weekdayDescriptions,
    website: website?.startsWith('https://') ? (website as `https://${string}`) : undefined,
    description: googlePlace.editorialSummary?.text,
    phone: googlePlace.nationalPhoneNumber,
    mapsUri: googlePlace.googleMapsUri,
    priceLevel: googlePlace.priceLevel
      ? PriceLevelSymbols[googlePlace.priceLevel]
      : undefined,
    reviews: mapReviews(googlePlace.reviews),
  };
}

export async function searchNearby(options: {
  apiKey: string;
  category: PlaceCategory;
  center: Coordinates;
  radius?: number;
  /** Origin of the incoming request, used to build photo-proxy URLs. */
  origin: string;
}): Promise<PlaceWithDistance[]> {
  const { apiKey, category, center, radius = DefaultRadiusMeters, origin } = options;

  const response = await fetch(NearbySearchEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': ListFieldMask,
    },
    body: JSON.stringify({
      includedTypes: CategoryTypes[category],
      maxResultCount: 20,
      // Nearest matches, not most prominent — the product is "what's closest
      // to me", so an unremarkable café 50m away beats a landmark 1.4km away.
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: { center, radius },
      },
      // Real walking times along streets, computed relative to the searcher
      routingParameters: {
        origin: center,
        travelMode: 'WALK',
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Places API ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as {
    places?: GooglePlace[];
    routingSummaries?: RoutingSummary[];
  };
  const mapped = (body.places ?? []).map((googlePlace) =>
    mapGooglePlace(googlePlace, category, origin, center)
  );
  return applyRoutingSummaries(mapped, body.routingSummaries)
    .filter((place): place is PlaceWithDistance => place !== null)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function getPlaceDetails(options: {
  apiKey: string;
  placeId: string;
  origin: string;
}): Promise<PlaceDetails | null> {
  const { apiKey, placeId, origin } = options;

  const response = await fetch(`${PlaceDetailsEndpoint}/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DetailsFieldMask,
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Place Details ${response.status}: ${detail.slice(0, 500)}`);
  }

  const body = (await response.json()) as GooglePlace;
  return mapGooglePlaceDetails(body, origin);
}
