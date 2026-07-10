import { findStory } from '@/server/wikipedia';

/**
 * GET /api/story?name=Tower%20Bridge&lat=51.5&lng=-0.07
 *
 * Returns { story, title, url } when a matching Wikipedia article exists,
 * or { story: null } when it doesn't (most cafes, many shops). Wikipedia
 * needs no API key — this lives server-side for consistency and so the
 * matching logic stays in one place.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name');
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');

  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Expected name, lat, and lng' }, { status: 400 });
  }

  try {
    const result = await findStory(name, { latitude: lat, longitude: lng });
    return Response.json(result ?? { story: null });
  } catch (error) {
    console.error('Story lookup failed:', error);
    // A missing story is a normal outcome, not a client-visible failure
    return Response.json({ story: null });
  }
}
