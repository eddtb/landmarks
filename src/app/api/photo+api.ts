/**
 * GET /api/photo?name=places/{place}/photos/{photo}
 *
 * Google photo URLs require the API key, so the app never builds them.
 * This route resolves the photo server-side and redirects to Google's
 * key-less CDN URL.
 */
const PhotoNamePattern = /^places\/[^/]+\/photos\/[^/]+$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get('name') ?? '';

  if (!PhotoNamePattern.test(name)) {
    return Response.json({ error: 'Invalid photo name' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Demo mode — deterministic placeholder image
    return Response.redirect(`https://picsum.photos/seed/${encodeURIComponent(name)}/800/500`, 302);
  }

  const mediaUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`;
  const response = await fetch(mediaUrl, { headers: { 'X-Goog-Api-Key': apiKey } });

  if (!response.ok) {
    return Response.json({ error: 'Photo lookup failed' }, { status: 502 });
  }

  const body = (await response.json()) as { photoUri?: string };
  if (!body.photoUri) {
    return Response.json({ error: 'Photo lookup failed' }, { status: 502 });
  }

  return Response.redirect(body.photoUri, 302);
}
