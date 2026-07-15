/** A regular recurring event at a venue, found on the web with a source. */
export type WhatsOnEvent = {
  /** e.g. "Quiz night" */
  title: string;
  /** e.g. "Sundays from 8pm" */
  schedule: string;
  /** e.g. "£2 entry" */
  detail?: string;
  /** The page that confirms the event — every claim carries its source. */
  sourceUrl: string;
};
