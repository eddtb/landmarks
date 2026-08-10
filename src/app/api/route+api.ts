import { coordinatesParam } from '@/server/params';
import { fetchWalkingRoute } from '@/server/route';

/**
 * GET /api/route?fromLat=..&fromLng=..&toLat=..&toLng=..
 *
 * A walking route from the free Valhalla server, origin-bucketed and
 * cached. Failure is a 502 the client treats as "keep the straight
 * line" — the route improves the walk, it never gates it.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  // The same absence-is-not-zero rule as /api/area (#305): four
  // missing parameters used to route from Null Island to Null Island
  const from = coordinatesParam(url.searchParams, 'fromLat', 'fromLng');
  const to = coordinatesParam(url.searchParams, 'toLat', 'toLng');
  if (!from || !to) {
    return Response.json({ error: 'Expected fromLat, fromLng, toLat, toLng' }, { status: 400 });
  }

  try {
    const route = await fetchWalkingRoute(from, to);
    if (!route) {
      return Response.json({ error: 'No route found' }, { status: 404 });
    }
    return Response.json({ route });
  } catch (error) {
    console.error('Route failed:', error);
    return Response.json({ error: 'Route failed' }, { status: 502 });
  }
}
