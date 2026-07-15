/**
 * GET /api/streetview?lat&lng — street-level imagery for places whose
 * Google listing has no photos (matching Google Maps' own fallback).
 *
 * Street View image URLs embed the API key, so unlike /api/photo (which
 * redirects to a key-less CDN) this endpoint streams the image bytes —
 * the key never reaches the client. The free metadata endpoint is checked
 * first so we don't pay for "no imagery here" responses.
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

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'No imagery available' }, { status: 404 });
  }

  const location = `${lat},${lng}`;

  try {
    const metadata = (await (
      await fetch(
        `https://maps.googleapis.com/maps/api/streetview/metadata?location=${location}&source=outdoor&key=${apiKey}`
      )
    ).json()) as { status?: string };

    if (metadata.status !== 'OK') {
      return Response.json({ error: 'No imagery available' }, { status: 404 });
    }

    const image = await fetch(
      `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${location}&source=outdoor&key=${apiKey}`
    );
    if (!image.ok) {
      return Response.json({ error: 'No imagery available' }, { status: 404 });
    }

    return new Response(image.body, {
      headers: {
        'Content-Type': image.headers.get('Content-Type') ?? 'image/jpeg',
        // Street scenes don't change often — let clients cache for a day
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Street View lookup failed:', error);
    return Response.json({ error: 'No imagery available' }, { status: 404 });
  }
}
