import { getTelling } from '@/server/telling';

/**
 * POST because the client must send the extract: the server holds no
 * per-story state — history lists are fetched by location and cached
 * on the device, so the story's own text rides in with the request.
 * The extract is bound into the telling's cache key (see telling.ts),
 * so a fabricated body can only ever poison its own cache slot.
 */

// Intro extracts run a few hundred words; heritage inscriptions less.
// Anything past this is not a story the app sent — cap what a stranger
// with the origin URL can make the model read (input tokens are the
// uncapped half of a generation).
const MaxExtractChars = 16_000;
const MaxTitleChars = 300;
// Refuse oversized bodies before JSON.parse does the work.
const MaxBodyBytes = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const declaredBytes = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > MaxBodyBytes) {
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { pageId, title, extract, source, area } = body as Record<string, unknown>;

  // The area's own telling: no pageId, cached by name
  const areaName = typeof area === 'string' && area.trim() ? area.slice(0, MaxTitleChars) : null;
  if (
    (typeof pageId !== 'number' && !areaName) ||
    typeof title !== 'string' ||
    typeof extract !== 'string'
  ) {
    return Response.json({ error: 'pageId (or area), title and extract are required' }, { status: 400 });
  }
  if (!extract.trim()) {
    // No source text, no telling — the model must never write from nothing
    return Response.json({ error: 'This story has no source text to tell from' }, { status: 422 });
  }
  if (title.length > MaxTitleChars || extract.length > MaxExtractChars) {
    return Response.json({ error: 'Body too large' }, { status: 413 });
  }

  try {
    const telling = await getTelling(
      {
        pageId: typeof pageId === 'number' ? pageId : 0,
        title,
        extract,
        source: typeof source === 'string' && source ? source.slice(0, MaxTitleChars) : 'Wikipedia',
      },
      areaName ? `area:${areaName.toLowerCase()}` : String(pageId)
    );
    if (!telling) {
      return Response.json({ error: 'No telling came back' }, { status: 502 });
    }
    return Response.json({ telling });
  } catch (error) {
    console.error('Telling failed:', error);
    return Response.json({ error: 'Telling failed' }, { status: 502 });
  }
}
