import { placesByCategory } from '@/data/mock-places';
import { getCachedList, setCachedList } from '@/server/list-cache';
import { searchNearby } from '@/server/google-places';
import { PlaceCategory } from '@/types/place';

const Categories: PlaceCategory[] = ['landmark', 'food', 'drink', 'activity'];

/**
 * GET /api/places?lat=51.5&lng=-0.09&category=landmark
 *
 * Runs server-side. The Google key is read from the server environment and
 * never reaches the client. Without a key (CI, fresh checkouts) it serves
 * the mock data set so the app still works in demo mode.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  const category = url.searchParams.get('category') as PlaceCategory;

  // Number(null) is 0, so missing params must be rejected before conversion
  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Categories.includes(category)) {
    return Response.json(
      { error: 'Expected lat, lng, and category (landmark | food | drink | activity)' },
      { status: 400 }
    );
  }

  const center = { latitude: lat, longitude: lng };
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;

  if (!apiKey) {
    console.warn('GOOGLE_PLACES_API_KEY not set — serving mock places (demo mode)');
    return Response.json({ places: placesByCategory(category, center), demo: true });
  }

  // The fix for £1-per-app-open: the server answers repeat questions
  // from its own disk-backed cache. One fetch per ~100m area bucket
  // per category per hour, shared across every app open and restart.
  // Pull-to-refresh is the deliberate escape hatch: fresh=1 forces a
  // real fetch (a cached "refresh" is a placebo button). Passive loads
  // still read the hour cache.
  const fresh = url.searchParams.get('fresh') === '1';
  const cached = fresh ? null : getCachedList(center, category);
  if (cached) {
    return Response.json({ places: cached, cached: true });
  }

  try {
    const places = await searchNearby({
      apiKey,
      category,
      center,
      origin: url.origin,
    });
    setCachedList(center, category, places);
    return Response.json({ places });
  } catch (error) {
    console.error('Nearby search failed:', error);
    return Response.json({ error: 'Places lookup failed' }, { status: 502 });
  }
}
