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
  /** Wikipedia-style summary. Present mostly for genuine landmarks. */
  story?: string;
};

export const CategoryLabels: Record<PlaceCategory, string> = {
  landmark: 'Landmark',
  restaurant: 'Restaurant',
  pub: 'Pub',
};
