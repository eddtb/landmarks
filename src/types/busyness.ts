export const BusynessLevels = ['quiet', 'moderate', 'busy', 'packed'] as const;
export type BusynessLevel = (typeof BusynessLevels)[number];

export const Weekdays = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;
export type Weekday = (typeof Weekdays)[number];

export const DayBands = ['morning', 'afternoon', 'evening', 'night'] as const;
export type DayBand = (typeof DayBands)[number];

export type DayPattern = Record<DayBand, BusynessLevel>;

/**
 * A typical-week busyness FORECAST — reasoned from venue type,
 * popularity, and known events, never sensed. Always presented with
 * "usually" and an estimate label.
 */
export type BusynessPattern = {
  pattern: Record<Weekday, DayPattern>;
  /** One standout worth knowing, e.g. "Packed on Sunday quiz nights". */
  note?: string;
};
