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

/** 17:30 -> "5:30pm", 9:00 -> "9am" — device-local, minutes only when odd. */
export function clockLabel(date: Date): string {
  const hour12 = date.getHours() % 12 || 12;
  const suffix = date.getHours() < 12 ? 'am' : 'pm';
  const minutes = date.getMinutes();
  return `${hour12}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}${suffix}`;
}

/** "2026-07-15T23:00:00Z" -> "Open until 11pm". */
export function openUntilLabel(nextCloseTime: string): string | null {
  const closesAt = new Date(nextCloseTime);
  if (!Number.isFinite(closesAt.getTime())) {
    return null;
  }
  return `Open until ${clockLabel(closesAt)}`;
}

const ShortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The closed card's hopeful counterpart: "Opens in 20 min" when it's
 * worth waiting, "Closed · Opens 5pm" same-day, "Closed · Opens Fri
 * 9am" beyond. Null when the moment is past or malformed.
 */
export function opensLabel(nextOpenTime: string, now: Date): string | null {
  const opensAt = new Date(nextOpenTime);
  if (!Number.isFinite(opensAt.getTime())) {
    return null;
  }
  const minutes = Math.round((opensAt.getTime() - now.getTime()) / 60000);
  if (minutes <= 0) {
    return null;
  }
  if (minutes <= 60) {
    return `Opens in ${minutes} min`;
  }
  const sameDay = opensAt.toDateString() === now.toDateString();
  const when = sameDay
    ? clockLabel(opensAt)
    : `${ShortDays[opensAt.getDay()]} ${clockLabel(opensAt)}`;
  return `Closed · Opens ${when}`;
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

/**
 * Does the record say this thing no longer exists? Two signals, never
 * invention: demolition words anywhere, or the defining first
 * sentence in the past tense — Wikipedia writes "the Palace of
 * Placentia WAS an English royal residence" for vanished things and
 * "Cutty Sark IS a British clipper ship" for standing ones. A first
 * sentence carrying both ("…is a church that was designed by…")
 * counts as standing.
 */
// Grammar-based existence classification (isVanished/historyTag) was
// retired here after three failed refinements: past-tense prose cannot
// tell a demolished palace from a dissolved institution in a standing
// building. Existence facts now come structured from Wikidata
// (src/server/wikidata.ts) and ride items as `pastTag`.

/** "https://en.wikipedia.org/wiki/Cutty_Sark" → "Cutty Sark", or null. */
export function wikiTitleFromUrl(url: string): string | null {
  const match = url.match(/wikipedia\.org\/wiki\/([^#?]+)/);
  if (!match) {
    return null;
  }
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

/**
 * Wikipedia intro extracts arrive as one block: paragraphs separated by
 * bare newlines, sometimes opening with a pronunciation parenthetical —
 * "Cutty Sark (/ˌkʌti ˈsɑːrk/) is…" — that reads as clutter on screen
 * and worse out loud. Split, strip, trim.
 */
export function storyParagraphs(extract: string): string[] {
  return extract
    .replace(/\s*\((?:[^)]*\/){2}[^)]*\)/g, '') // parentheticals with /IPA/ inside
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/**
 * The history card's hook: the extract's first sentence, because
 * "a nuclear reactor ran here until 1996" is the reason to tap and
 * the title alone never says it. Capped so a rambling opening
 * sentence can't swallow the card.
 */
export function storyHook(extract: string | undefined): string | undefined {
  if (!extract) {
    return undefined;
  }
  const clean = storyParagraphs(extract)[0] ?? '';
  const match = clean.match(/^.*?\.(?=\s|$)/);
  const sentence = (match?.[0] ?? clean).trim();
  if (sentence.length <= 160) {
    return sentence;
  }
  return `${sentence.slice(0, 157).trimEnd()}…`;
}

/**
 * The clock corrects the cache: openNow is a snapshot from fetch
 * time, but nextCloseTime/nextOpenTime are exact moments — so the
 * honest current state is derivable free. A venue past its close
 * shows closed; one past its open shows open. Openness stays
 * truthful through the whole cached hour without another API call.
 */
export function liveOpenNow(
  place: { openNow?: boolean; nextCloseTime?: string; nextOpenTime?: string },
  now: Date = new Date()
): boolean | undefined {
  if (place.openNow === true && place.nextCloseTime && now >= new Date(place.nextCloseTime)) {
    return false;
  }
  if (place.openNow === false && place.nextOpenTime && now >= new Date(place.nextOpenTime)) {
    return true;
  }
  return place.openNow;
}
