import { BusynessLevel, BusynessPattern, DayBand, Weekday, Weekdays } from '@/types/busyness';

/** Which forecast slot the user is living in right now (device time). */
export function currentSlot(date: Date): { day: Weekday; band: DayBand } {
  // getDay() is Sunday-first; Weekdays is Monday-first
  const day = Weekdays[(date.getDay() + 6) % 7];
  const hour = date.getHours();
  const band: DayBand =
    hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 20 ? 'evening' : 'night';
  return { day, band };
}

// Google's own register — and "usually" itself carries the "this is
// a typical pattern, not a live reading" disclosure.
const LevelPhrases: Record<BusynessLevel, string> = {
  quiet: 'Usually not busy',
  moderate: 'Usually a little busy',
  busy: 'Usually busy',
  packed: 'Usually very busy',
};

/** The one line the detail screen shows — always "usually", never "now". */
export function describeBusyness(pattern: BusynessPattern, date: Date): string {
  const { day, band } = currentSlot(date);
  return LevelPhrases[pattern.pattern[day][band]];
}
