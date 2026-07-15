import { MockTodayEvents } from '@/data/mock-today';
import { fetchTodayEvents } from '@/server/anthropic';
import { findVenueNearby } from '@/server/google-places';
import { TodayEvent } from '@/types/today';

/**
 * GET /api/today?lat&lng&area — what's happening near here today,
 * researched by Claude with web search, each event grounded to a real
 * Google place when its venue exists nearby (photo, distance, and the
 * tap-through to the place screen — plus a hallucination guard).
 *
 * Day-scoped by design: the cache key is date + ~1km grid, so one
 * research call covers everyone in an area for the whole day.
 */

type CacheEntry = { events: TodayEvent[] };

// globalThis: the dev server re-evaluates route modules per request
const globalCache = globalThis as { todayCache?: Map<string, CacheEntry> };
const cache = (globalCache.todayCache ??= new Map<string, CacheEntry>());

/** "2026-07-15" and "Wednesday 15 July 2026", both London time. */
function londonToday(): { dateKey: string; dateLabel: string } {
  const now = new Date();
  const dateKey = now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  const dateLabel = now.toLocaleDateString('en-GB', {
    timeZone: 'Europe/London',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return { dateKey, dateLabel };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const latParam = url.searchParams.get('lat');
  const lngParam = url.searchParams.get('lng');
  const area = url.searchParams.get('area');
  const lat = latParam ? Number(latParam) : NaN;
  const lng = lngParam ? Number(lngParam) : NaN;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'Expected lat and lng' }, { status: 400 });
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.warn('ANTHROPIC_API_KEY not set — serving mock events (demo mode)');
    return Response.json({ events: MockTodayEvents, demo: true });
  }

  const { dateKey, dateLabel } = londonToday();
  // ~1km grid: one research call serves the whole neighbourhood
  const cacheKey = `${dateKey}|${lat.toFixed(2)},${lng.toFixed(2)}`;

  // Yesterday's answers are dead weight — drop keys from other days
  for (const key of cache.keys()) {
    if (!key.startsWith(dateKey)) {
      cache.delete(key);
    }
  }

  const cached = cache.get(cacheKey);
  if (cached) {
    return Response.json({ events: cached.events });
  }

  const center = { latitude: lat, longitude: lng };
  const areaLabel = area?.trim()
    ? `${area.trim()}, London`
    : `the area around latitude ${lat}, longitude ${lng} in London`;

  try {
    const found = await fetchTodayEvents({ apiKey: anthropicKey, dateLabel, areaLabel });
    const events = await groundEvents(found, center, url.origin);
    cache.set(cacheKey, { events });
    return Response.json({ events });
  } catch (error) {
    console.error('Today lookup failed:', error);
    return Response.json({ error: 'Today lookup failed' }, { status: 502 });
  }
}

/**
 * Attach each event to its real nearby place. Venues Google can't find
 * within walking range are dropped — either hallucinated or too far.
 * Without a Google key, events pass through ungrounded.
 */
async function groundEvents(
  events: TodayEvent[],
  center: { latitude: number; longitude: number },
  origin: string
): Promise<TodayEvent[]> {
  const googleKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleKey) {
    return events;
  }

  // At most 12 events (parser cap), so one parallel burst is fine
  const grounded = await Promise.all(
    events.map(async (event) => {
      try {
        const venue = await findVenueNearby({
          apiKey: googleKey,
          name: event.venue,
          center,
          origin,
        });
        if (!venue) {
          return null;
        }
        return {
          ...event,
          placeId: venue.placeId,
          photoUrl: venue.photoUrl,
          distanceMeters: venue.distanceMeters,
        };
      } catch (error) {
        // Grounding is enhancement: a Places hiccup shouldn't kill the event
        console.warn('Venue grounding failed:', error);
        return event;
      }
    })
  );
  return grounded.filter((event): event is TodayEvent => event !== null);
}
