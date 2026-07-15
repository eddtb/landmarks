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

const LevelPhrases: Record<BusynessLevel, string> = {
  quiet: 'Usually quiet around this time',
  moderate: 'Usually fairly quiet around this time',
  busy: 'Usually busy around this time',
  packed: 'Usually packed around this time',
};

/** The one line the detail screen shows — always "usually", never "now". */
export function describeBusyness(pattern: BusynessPattern, date: Date): string {
  const { day, band } = currentSlot(date);
  return LevelPhrases[pattern.pattern[day][band]];
}
