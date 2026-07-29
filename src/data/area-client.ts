import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { Coordinates } from '@/utils/geo';

/**
 * The nearest named area's article title, or null when nowhere nearby
 * is one. Server-side bucket-cached for 30 days (src/server/area.ts);
 * the caller (use-area-name) single-flights per bucket, so this is at
 * most one request per area the user visits.
 *
 * THROWS when the ask fails. The cascade must be able to tell "there is
 * no area article here" (fall through, and cache the winner) from "we
 * could not find out" (fall through, but re-ask next look) — collapsing
 * the two is how a transient 502 would pin "Bromley" to a bucket.
 */
export async function fetchNearestArea(center: Coordinates): Promise<string | null> {
  const response = await fetch(
    apiUrl(`/api/area?lat=${center.latitude}&lng=${center.longitude}`)
  );
  if (!response.ok) {
    throw new Error(`Area name request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { name?: string | null };
  return body.name ?? null;
}
