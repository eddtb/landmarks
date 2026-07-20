import { Coordinates } from '@/utils/geo';

/** A Wikipedia article about something near the user — often a thing that
 * no longer exists or was an event, so it has no business listing anywhere. */
export type HistoryItem = {
  pageId: number;
  title: string;
  coordinates: Coordinates;
  distanceMeters: number;
  extract?: string;
  thumbnailUrl?: string;
  url: string;
  /** Where the story came from: "Wikipedia" now; heritage sources join in PR-E. */
  source: string;
};
