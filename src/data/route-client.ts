import { cachedGet } from '@/data/cached-get';
import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';

// Session cache on the same ~27m origin grid the server uses
const cache = new Map<string, WalkingRoute>();

function key(from: Coordinates, to: Coordinates): string {
  return (
    `${Math.round(from.latitude * 4000) / 4000}|${Math.round(from.longitude * 4000) / 4000}` +
    `→${to.latitude.toFixed(5)},${to.longitude.toFixed(5)}`
  );
}

export async function fetchRoute(from: Coordinates, to: Coordinates): Promise<WalkingRoute> {
  const params = new URLSearchParams({
    fromLat: String(from.latitude),
    fromLng: String(from.longitude),
    toLat: String(to.latitude),
    toLng: String(to.longitude),
  });
  return cachedGet({
    cache,
    key: key(from, to),
    path: `/api/route?${params}`,
    label: 'Route',
    unwrap: (body: { route: WalkingRoute }) => body.route,
  });
}
