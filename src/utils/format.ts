/** 850 -> "850 m", 1240 -> "1.2 km" */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

/** 4.6 -> "★ 4.6" */
export function formatRating(rating: number): string {
  return `★ ${rating.toFixed(1)}`;
}

/** 73 -> "1 min walk", 260 -> "4 min walk" */
export function formatWalkTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min walk`;
}

/** How close to closing counts as "soon" — one drink's worth of warning. */
const ClosesSoonWindowMinutes = 60;

/**
 * "Closes in 40 min" when the moment is within the warning window,
 * null otherwise — arriving 15 minutes before close is the classic
 * city failure this exists to prevent.
 */
export function closesSoonLabel(nextCloseTime: string, now: Date): string | null {
  const closesAt = Date.parse(nextCloseTime);
  if (!Number.isFinite(closesAt)) {
    return null;
  }
  const minutes = Math.round((closesAt - now.getTime()) / 60000);
  if (minutes <= 0 || minutes > ClosesSoonWindowMinutes) {
    return null;
  }
  return `Closes in ${minutes} min`;
}

/** "2026-07-15T23:00:00Z" -> "Open until 11pm" (device-local, minutes only when odd). */
export function openUntilLabel(nextCloseTime: string): string | null {
  const closesAt = new Date(nextCloseTime);
  if (!Number.isFinite(closesAt.getTime())) {
    return null;
  }
  const hour12 = closesAt.getHours() % 12 || 12;
  const suffix = closesAt.getHours() < 12 ? 'am' : 'pm';
  const minutes = closesAt.getMinutes();
  return `Open until ${hour12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${suffix}`;
}

const DayAbbrev: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

/** "11:00 AM – 11:00 PM" -> "11am–11pm"; ":30" minutes survive. */
export function compactTimeRange(times: string): string {
  return times
    .replace(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/gi, (_match, hour, minutes, meridiem) => {
      const mins = minutes && minutes !== '00' ? `:${minutes}` : '';
      return `${hour}${mins}${meridiem.toLowerCase()}`;
    })
    .replace(/\s*–\s*/g, '–')
    // Bare ":00" without a meridiem (Google writes "12:00 – 9:00 PM")
    .replace(/(\d{1,2}):00\b(?!\s*[ap]m)/gi, '$1')
    .replace(/Open 24 hours/i, '24 hours');
}

/** Google's verbose weekday line, made concise: "Mon 11am–11pm". */
export function formatHoursLine(line: string): string {
  const separator = line.indexOf(': ');
  if (separator === -1) {
    return compactTimeRange(line);
  }
  const day = line.slice(0, separator);
  const times = line.slice(separator + 2);
  return `${DayAbbrev[day] ?? day} ${compactTimeRange(times)}`;
}

/** 847 -> "847", 2310 -> "2.3k" — evidence for the rating, card-sized */
export function formatRatingCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
