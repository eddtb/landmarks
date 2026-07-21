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
  const values = ['fromLat', 'fromLng', 'toLat', 'toLng'].map((name) =>
    Number(url.searchParams.get(name))
  );
  if (values.some((value) => !Number.isFinite(value))) {
    return Response.json({ error: 'Expected fromLat, fromLng, toLat, toLng' }, { status: 400 });
  }
  const [fromLat, fromLng, toLat, toLng] = values;

  try {
    const route = await fetchWalkingRoute(
      { latitude: fromLat, longitude: fromLng },
      { latitude: toLat, longitude: toLng }
    );
    if (!route) {
      return Response.json({ error: 'No route found' }, { status: 404 });
    }
    return Response.json({ route });
  } catch (error) {
    console.error('Route failed:', error);
    return Response.json({ error: 'Route failed' }, { status: 502 });
  }
}
