import { Coordinates } from '@/utils/geo';

export type PlaceCategory = 'landmark' | 'restaurant' | 'pub';

export type Place = {
  id: string;
  name: string;
  category: PlaceCategory;
  coordinates: Coordinates;
  rating: number;
  photoUrl: string;
  address: string;
  hours?: string;
  website?: `https://${string}`;
  /** Google's short editorial description — the fallback when no Wikipedia article exists. */
  description?: string;
  ratingCount?: number;
  /** Wikipedia-style summary. Present mostly for genuine landmarks. */
  story?: string;
};

export type PlaceWithDistance = Place & { distanceMeters: number };

/** Rich fields fetched one place at a time from /api/place/[id] (M1: two-tier fetching). */
export type PlaceDetails = Place & {
  /** e.g. ["Monday: 9:00 AM – 5:00 PM", ...] */
  weekdayHours?: string[];
  phone?: string;
  mapsUri?: string;
  /** "£" | "££" | "£££" | "££££" */
  priceLevel?: string;
  /** All photos, proxied — photoUrl remains the first one. */
  photoUrls: string[];
};

export const CategoryLabels: Record<PlaceCategory, string> = {
  landmark: 'Landmark',
  restaurant: 'Restaurant',
  pub: 'Pub',
};
