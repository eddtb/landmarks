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
  /** The article is ABOUT an event — a crash, a battle, a fire
   * (Wikidata P31 in the curated event set, src/server/wikidata.ts).
   * Events live in the History archive, never the Nearby feed (Edd's
   * ruling), photo or no photo — you can't walk to a happening. */
  event?: true;
  /** A plaque's resolved subject when the feed already tells that
   * story under its own card: the story screen opens the subject's
   * Gazetteer while the card keeps the honest inscription. */
  subject?: string;
};

/** The feed plus how it was gathered — the /api/history response
 * shape, shared by the route (src/app/api/history+api.ts) and the
 * client (src/data/history-client.ts), which also persists it whole.
 * `sparse` means the server found a quiet corner and widened the
 * Wikipedia search to fill it; `dressing` means the server answered
 * before its photo leg finished — the text is complete, thumbnails
 * are still being fetched, and one delayed re-ask (useHistory's job)
 * will collect them. */
export type HistoryFeed = {
  items: HistoryItem[];
  sparse?: boolean;
  /** How far the widened search actually reached, in meters — rides
   * with `sparse` so the count-line copy can derive its "up to ~N min
   * walk" from what the server DID, not from a hardcoded radius. */
  horizon?: number;
  dressing?: boolean;
};

/**
 * Heritage items carry synthetic pageIds far above real Wikipedia
 * pageids (listed buildings from 2e9, plaques from 3e9 — the bases in
 * server/heritage.ts). Only a real Wikipedia pageId can be re-fetched
 * on its own, so only those earn a landmarks:// share deep-link.
 */
export const SyntheticPageIdBase = 2_000_000_000;

export function isWikiPageId(pageId: number): boolean {
  return Number.isInteger(pageId) && pageId > 0 && pageId < SyntheticPageIdBase;
}
