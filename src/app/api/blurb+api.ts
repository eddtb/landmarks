import { fetchPlaceBlurb } from '@/server/anthropic';

/**
 * GET /api/blurb?id&name&label&address — an AI-researched description
 * for places where Wikipedia and Google's editorial both come up
 * empty. What a place IS barely changes, so results (including
 * declines) cache for 30 days.
 */

/** Found blurbs are stable for a month; declines retry after days —
 * research is nondeterministic and a fluke shouldn't stick. */
const FoundTtlMs = 30 * 24 * 60 * 60 * 1000;
const DeclineTtlMs = 3 * 24 * 60 * 60 * 1000;

type CacheEntry = { blurb: string | null; fetchedAt: number };

// globalThis: the dev server re-evaluates route modules per request
const globalCache = globalThis as { blurbCache?: Map<string, CacheEntry> };
const cache = (globalCache.blurbCache ??= new Map<string, CacheEntry>());

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const name = url.searchParams.get('name');
  const label = url.searchParams.get('label') ?? 'place';
  const address = url.searchParams.get('address') ?? '';

  if (!id || !name) {
    return Response.json({ error: 'Expected id and name' }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ blurb: null });
  }

  const cached = cache.get(id);
  const ttl = cached && cached.blurb ? FoundTtlMs : DeclineTtlMs;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return Response.json({ blurb: cached.blurb });
  }

  try {
    const blurb = await fetchPlaceBlurb({ apiKey, name, typeLabel: label, address });
    cache.set(id, { blurb, fetchedAt: Date.now() });
    return Response.json({ blurb });
  } catch (error) {
    console.error('Blurb lookup failed:', error);
    return Response.json({ blurb: null });
  }
}
