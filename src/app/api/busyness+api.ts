import { diskBackedMap } from '@/server/ai-cache';
import { fetchBusynessPattern } from '@/server/anthropic';
import { BusynessPattern } from '@/types/busyness';
import { WhatsOnEvent } from '@/types/whats-on';

/**
 * GET /api/busyness?id&name&label&ratingCount&address — a typical-week
 * busyness forecast for one venue: Claude reasoning over signals we
 * hold (type, popularity, known events), no web search. Weekly rhythms
 * barely change, so results cache for 30 days.
 *
 * The known-events signal is read straight from the What's-on cache —
 * a venue whose quiz night we've already researched gets a forecast
 * that knows about it, free.
 */

const CacheTtlMs = 30 * 24 * 60 * 60 * 1000;

type CacheEntry = { pattern: BusynessPattern | null; fetchedAt: number };
type WhatsOnCacheEntry = { events: WhatsOnEvent[]; fetchedAt: number };

// globalThis: the dev server re-evaluates route modules per request
const globalCache = globalThis as {
  busynessCache?: Map<string, CacheEntry>;
  whatsOnCache?: Map<string, WhatsOnCacheEntry>;
};
const cache = (globalCache.busynessCache ??= diskBackedMap<CacheEntry>('busyness'));

function knownEvents(placeId: string): string[] {
  const cached = globalCache.whatsOnCache?.get(placeId);
  return (cached?.events ?? []).map(
    (event) => `${event.title} (${event.schedule})${event.detail ? ` — ${event.detail}` : ''}`
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const name = url.searchParams.get('name');
  const label = url.searchParams.get('label') ?? 'venue';
  const ratingCount = Number(url.searchParams.get('ratingCount') ?? '0');
  const address = url.searchParams.get('address') ?? '';

  if (!id || !name) {
    return Response.json({ error: 'Expected id and name' }, { status: 400 });
  }

  // Either provider serves; the router in anthropic.ts picks
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey && !process.env.GEMINI_API_KEY) {
    return Response.json({ pattern: null });
  }

  const cached = cache.get(id);
  if (cached && Date.now() - cached.fetchedAt < CacheTtlMs) {
    return Response.json({ pattern: cached.pattern });
  }

  try {
    const pattern = await fetchBusynessPattern({
      apiKey,
      name,
      typeLabel: label,
      ratingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
      address,
      events: knownEvents(id),
    });
    cache.set(id, { pattern, fetchedAt: Date.now() });
    return Response.json({ pattern });
  } catch (error) {
    console.error('Busyness forecast failed:', error);
    return Response.json({ pattern: null });
  }
}
