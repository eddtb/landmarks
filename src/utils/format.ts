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
