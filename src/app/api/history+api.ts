import { assignPhotos, fetchAreaPhotos } from '@/server/geograph';
import { fetchListedBuildings, fetchPlaques, mergeHistorySources } from '@/server/heritage';
import { findNearbyHistory } from '@/server/wikipedia';

/**
 * GET /api/history?lat=51.5&lng=-0.09
 *
 * The stories of where you stand: Wikipedia is the backbone, Historic
 * England and Open Plaques enrich or extend it, Geograph dresses the
 * unillustrated. All upstreams keyless or free-keyed; a missing
 * heritage source degrades to fewer stories, never to an error.
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
  const center = { latitude: lat, longitude: lng };

  try {
    const [wikipedia, listed, plaques, photos] = await Promise.allSettled([
      findNearbyHistory(center),
      fetchListedBuildings(center),
      fetchPlaques(center),
      fetchAreaPhotos(center),
    ]);

    // Wikipedia is the backbone — without it there is no screen
    if (wikipedia.status === 'rejected') {
      throw wikipedia.reason;
    }
    for (const settled of [listed, plaques, photos]) {
      if (settled.status === 'rejected') {
        console.warn('History source degraded:', settled.reason);
      }
    }

    const merged = mergeHistorySources(
      wikipedia.value,
      listed.status === 'fulfilled' ? listed.value : [],
      plaques.status === 'fulfilled' ? plaques.value : []
    );
    const items = assignPhotos(merged, photos.status === 'fulfilled' ? photos.value : []);
    return Response.json({ items });
  } catch (error) {
    console.error('History lookup failed:', error);
    return Response.json({ error: 'History lookup failed' }, { status: 502 });
  }
}
