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
  /** Where the story came from: "Wikipedia", "Historic England · Grade II",
   * "Open Plaques" — or an enriched blend like "Wikipedia · Grade I listed". */
  source: string;
  /** CC BY-SA attribution when the photo is Geograph's, not Wikipedia's. */
  thumbnailCredit?: string;
  /** A structured existence fact from Wikidata — "Demolished 1936",
   * "Until 1675", "Former hospital" — or absent: honest silence. */
  pastTag?: string;
  /** A plaque's resolved subject when the feed already tells that
   * story under its own card: the story screen opens the subject's
   * Gazetteer while the card keeps the honest inscription. */
  subject?: string;
};
