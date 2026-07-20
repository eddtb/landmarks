import { placeById } from '@/data/mock-places';
import { diskBackedMap } from '@/server/ai-cache';
import { PlaceDetails } from '@/types/place';
import { getPlaceDetails } from '@/server/google-places';

const PlaceIdPattern = /^[A-Za-z0-9_-]+$/;

/**
 * The last uncached billed surface (found by the meter, 2026-07-20):
 * details were fetched fresh on EVERY venue-screen mount — ~3p a tap,
 * dozens a day from ordinary poking around. Weekly hours, websites,
 * and phone numbers don't change by lunchtime; live open-state comes
 * clock-corrected from list data. 24h on disk.
 */
type CacheEntry = { place: PlaceDetails; expires: number };
const cache = diskBackedMap<CacheEntry>('place-details');
const TtlMs = 24 * 60 * 60 * 1000;

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

  const cached = cache.get(id);
  if (cached && cached.expires > Date.now()) {
    return Response.json({ place: cached.place, cached: true });
  }

  try {
    const url = new URL(request.url);
    const place = await getPlaceDetails({ apiKey, placeId: id, origin: url.origin });
    if (!place) {
      return Response.json({ error: 'Place not found' }, { status: 404 });
    }
    cache.set(id, { place, expires: Date.now() + TtlMs });
    return Response.json({ place });
  } catch (error) {
    console.error('Place details failed:', error);
    return Response.json({ error: 'Place lookup failed' }, { status: 502 });
  }
}
