/**
 * GET /api/photo?place={placeId}&i={index}
 *
 * The app's photo URLs are keyed by place + index so they stay stable
 * across responses (Google's own photo names carry a rotating token —
 * URLs built from them defeat the image cache and the venue hero
 * visibly refetches). This route maps the stable key to the current
 * token via the photo-names cache, then redirects to Google's
 * key-less CDN URL. The key itself never leaves the server.
 */
import { fetchPhotoNames, getRememberedPhotoName } from '@/server/photo-names';

const MaxPhotoIndex = 9;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const placeId = url.searchParams.get('place') ?? '';
  const index = Number(url.searchParams.get('i') ?? '0');

  if (!placeId || !Number.isInteger(index) || index < 0 || index > MaxPhotoIndex) {
    return Response.json({ error: 'Expected place and i (0-9)' }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    // Demo mode — deterministic placeholder image
    return Response.redirect(
      `https://picsum.photos/seed/${encodeURIComponent(`${placeId}-${index}`)}/800/500`,
      302
    );
  }

  let name = getRememberedPhotoName(placeId, index);
  if (!name) {
    name = (await fetchPhotoNames(placeId, apiKey))[index];
  }
  if (!name) {
    return Response.json({ error: 'No such photo' }, { status: 404 });
  }

  let photoUri = await resolveMediaUri(name, apiKey);
  if (!photoUri) {
    // The cached token can expire at Google's end — re-learn and retry once
    name = (await fetchPhotoNames(placeId, apiKey))[index];
    photoUri = name ? await resolveMediaUri(name, apiKey) : undefined;
  }
  if (!photoUri) {
    return Response.json({ error: 'Photo lookup failed' }, { status: 502 });
  }

  return Response.redirect(photoUri, 302);
}

async function resolveMediaUri(name: string, apiKey: string): Promise<string | undefined> {
  const mediaUrl = `https://places.googleapis.com/v1/${name}/media?maxWidthPx=800&skipHttpRedirect=true`;
  const response = await fetch(mediaUrl, { headers: { 'X-Goog-Api-Key': apiKey } });
  if (!response.ok) {
    return undefined;
  }
  const body = (await response.json()) as { photoUri?: string };
  return body.photoUri;
}
