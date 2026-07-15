/** Something happening today near the user, found on the web with a source. */
export type TodayEvent = {
  /** e.g. "Live music with Alex West" */
  title: string;
  /** e.g. "Trafalgar Tavern" */
  venue: string;
  /** e.g. "8pm" or "All day" */
  time: string;
  detail?: string;
  /** The page that confirms the event — every claim carries its source. */
  sourceUrl: string;
  /** Set when the venue was grounded to a real Google place nearby. */
  placeId?: string;
  photoUrl?: string;
  distanceMeters?: number;
};
