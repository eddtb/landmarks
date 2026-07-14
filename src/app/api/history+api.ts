import { findNearbyHistory } from '@/server/wikipedia';

/**
 * GET /api/history?lat=51.5&lng=-0.09
 *
 * Wikipedia articles physically near the user — the "hidden history"
 * section. Keyless upstream, so this works in demo mode too.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');

  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Expected lat and lng' }, { status: 400 });
  }

  try {
    const items = await findNearbyHistory({ latitude: lat, longitude: lng });
    return Response.json({ items });
  } catch (error) {
    console.error('History lookup failed:', error);
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
