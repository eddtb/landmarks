import { computeWalkingRoute } from '@/server/google-routes';
import { distanceMeters } from '@/utils/geo';

/**
 * GET /api/route?fromLat&fromLng&toLat&toLng — walking steps between two
 * points. Demo mode (no key) returns a single straight-line step so the
 * UI still works.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parse = (name: string) => {
    const value = url.searchParams.get(name);
    return value ? Number(value) : NaN;
  };
  const fromLat = parse('fromLat');
  const fromLng = parse('fromLng');
  const toLat = parse('toLat');
  const toLng = parse('toLng');

  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    return Response.json(
      { error: 'Expected fromLat, fromLng, toLat, and toLng' },
      { status: 400 }
    );
  }

  const from = { latitude: fromLat, longitude: fromLng };
  const to = { latitude: toLat, longitude: toLng };
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    const meters = Math.round(distanceMeters(from, to));
    return Response.json({
      route: {
        seconds: Math.round(meters / 1.33),
        meters,
        steps: [{ instruction: 'Head towards your destination', meters, start: from, end: to }],
      },
      demo: true,
    });
  }

  try {
    const route = await computeWalkingRoute(apiKey, from, to);
    if (!route) {
      return Response.json({ error: 'No route found' }, { status: 404 });
    }
    return Response.json({ route });
  } catch (error) {
    console.error('Route lookup failed:', error);
    return Response.json({ error: 'Route lookup failed' }, { status: 502 });
  }
}
