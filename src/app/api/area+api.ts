import { findNearestArea } from '@/server/area';
import { fixturesEnabled } from '@/server/fixtures';
import { storeHealthHeaders } from '@/server/telling-store';

/**
 * GET /api/area?lat=51.4226&lng=-0.0685
 *
 * The name of the ground the user is standing on: the nearest article
 * Wikidata classes as an area — "Crystal Palace, London" beside the
 * park, where Apple's placemark says "Bromley" (see src/server/area.ts
 * for why the geocoder is no longer asked first).
 *
 * `{ name: null }` is a real answer, not an error: plenty of ground has
 * no area article near it, and the client's cascade falls through to
 * the geocoder's own fields. A 502 means we could not ask — the client
 * treats that as "no verdict yet" and re-asks on the next look, so a
 * rate-limited minute can never freeze a borough's name onto a bucket.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get('lat'));
  const lng = Number(url.searchParams.get('lng'));

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Expected lat and lng' }, { status: 400 });
  }

  // Hermetic E2E: the runner's IP gets 429'd by Wikipedia and Wikidata,
  // and "no area article here" is a verdict the cascade already knows
  // how to handle — it falls through to the mocked geocoder, keeping
  // the recorded flows byte-stable without a fixture to maintain.
  if (fixturesEnabled()) {
    return Response.json({ name: null });
  }

  try {
    const name = await findNearestArea({ latitude: lat, longitude: lng });
    // The area cache rides the same table as the tellings — so this
    // route reports the store's health too. It is also the cheapest
    // URL to curl after a deploy.
    return Response.json({ name }, { headers: storeHealthHeaders() });
  } catch (error) {
    console.error('Area name lookup failed:', error);
    return Response.json(
      { error: 'Area name lookup failed' },
      { status: 502, headers: storeHealthHeaders() }
    );
  }
}
