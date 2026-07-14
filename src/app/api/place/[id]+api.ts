import { placeById } from '@/data/mock-places';
import { getPlaceDetails } from '@/server/google-places';

const PlaceIdPattern = /^[A-Za-z0-9_-]+$/;

/**
 * GET /api/place/:id — rich details for one place (two-tier fetching).
 * Demo mode (no key) serves the mock place with details-shaped fields.
 */
export async function GET(request: Request, { id }: Record<string, string>) {
  if (!id || !PlaceIdPattern.test(id)) {
    return Response.json({ error: 'Invalid place id' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    const mock = placeById(id);
    if (!mock) {
      return Response.json({ error: 'Place not found' }, { status: 404 });
    }
    return Response.json({ place: { ...mock, photoUrls: [mock.photoUrl] }, demo: true });
  }

  try {
    const url = new URL(request.url);
    const place = await getPlaceDetails({ apiKey, placeId: id, origin: url.origin });
    if (!place) {
      return Response.json({ error: 'Place not found' }, { status: 404 });
    }
    return Response.json({ place });
  } catch (error) {
    console.error('Place details failed:', error);
    return Response.json({ error: 'Place lookup failed' }, { status: 502 });
  }
}
