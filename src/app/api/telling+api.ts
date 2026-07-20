import { getTelling } from '@/server/telling';

/**
 * POST because the client must send the extract: the server holds no
 * per-story state — history lists are fetched by location and cached
 * on the device, so the story's own text rides in with the request.
 */
export async function POST(request: Request): Promise<Response> {
  let body: { pageId?: unknown; title?: unknown; extract?: unknown; source?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { pageId, title, extract, source } = body;
  if (typeof pageId !== 'number' || typeof title !== 'string' || typeof extract !== 'string') {
    return Response.json({ error: 'pageId, title and extract are required' }, { status: 400 });
  }
  if (!extract.trim()) {
    // No source text, no telling — the model must never write from nothing
    return Response.json({ error: 'This story has no source text to tell from' }, { status: 422 });
  }

  try {
    const telling = await getTelling({
      pageId,
      title,
      extract,
      source: typeof source === 'string' && source ? source : 'Wikipedia',
    });
    if (!telling) {
      return Response.json({ error: 'No telling came back' }, { status: 502 });
    }
    return Response.json({ telling });
  } catch (error) {
    console.error('Telling failed:', error);
    return Response.json({ error: 'Telling failed' }, { status: 502 });
  }
}
