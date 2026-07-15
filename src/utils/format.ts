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

/** 847 -> "847", 2310 -> "2.3k" — evidence for the rating, card-sized */
export function formatRatingCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
}
