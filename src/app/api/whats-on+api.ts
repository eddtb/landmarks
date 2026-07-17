import { diskBackedMap } from '@/server/ai-cache';
import { fetchWhatsOn } from '@/server/anthropic';
import { WhatsOnEvent } from '@/types/whats-on';

/**
 * GET /api/whats-on?id&name&address — regular events at one venue,
 * researched by Claude with web search (see src/server/anthropic.ts).
 *
 * Recurring events are stable, so results cache server-side for two
 * weeks — each venue costs roughly a penny per fortnight, and only if
 * someone actually taps it. Failures and missing API keys degrade to an
 * empty list: the section simply doesn't render.
 */

/**
 * Found events are stable for weeks. Empty results get a short TTL:
 * web search is nondeterministic and an unlucky pass shouldn't lock a
 * venue's quiz night out for a fortnight.
 */
const FoundTtlMs = 14 * 24 * 60 * 60 * 1000;
const EmptyTtlMs = 24 * 60 * 60 * 1000;

type CacheEntry = { events: WhatsOnEvent[]; fetchedAt: number };

// The dev server re-evaluates this module per request, wiping module
// state — so the cache lives on globalThis, which survives within the
// server process. (Verified: a plain module Map re-researched — and
// re-billed — every identical request.)
const globalCache = globalThis as { whatsOnCache?: Map<string, CacheEntry> };
const cache = (globalCache.whatsOnCache ??= diskBackedMap<CacheEntry>('whats-on'));

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const name = url.searchParams.get('name');
  const address = url.searchParams.get('address') ?? '';

  if (!id || !name) {
    return Response.json({ error: 'Expected id and name' }, { status: 400 });
  }

  // Either provider serves; the router in anthropic.ts picks
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey && !process.env.GEMINI_API_KEY) {
    return Response.json({ events: [] });
  }

  const cached = cache.get(id);
  const ttl = cached && cached.events.length > 0 ? FoundTtlMs : EmptyTtlMs;
  if (cached && Date.now() - cached.fetchedAt < ttl) {
    return Response.json({ events: cached.events });
  }

  try {
    const events = await fetchWhatsOn({ apiKey, name, address });
    cache.set(id, { events, fetchedAt: Date.now() });
    return Response.json({ events });
  } catch (error) {
    console.error("What's-on lookup failed:", error);
    return Response.json({ events: [] });
  }
}
