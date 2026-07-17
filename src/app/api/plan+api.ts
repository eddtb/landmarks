import { placesByCategory } from '@/data/mock-places';
import { fetchPlanAnnotations } from '@/server/anthropic';
import { searchNearby } from '@/server/google-places';
import { computeWalkingRoute } from '@/server/google-routes';
import { CandidatePools, rebaseTimes, shortTime, solvePlan, SolvedPlan } from '@/server/plan';
import { fetchWeatherWindow } from '@/server/weather';
import { findNearbyHistory } from '@/server/wikipedia';
import { HistoryItem } from '@/types/history';
import { PlaceCategory, PlaceWithDistance } from '@/types/place';
import { Plan, PlanCompany, PlanDuration } from '@/types/plan';
import { Coordinates } from '@/utils/geo';
import { sunsetAt } from '@/utils/sun';

/**
 * GET /api/plan?lat&lng&duration=evening&company=date
 *
 * The Plan engine's orchestration: gather grounded candidates, let
 * the solver assemble stops + alternates in code, compute real
 * walking legs, revalidate every window, then ask Claude for the
 * voice (title, whys, leg notes) — which is garnish: a failed
 * annotation still returns a complete, factual plan.
 */

const Durations: PlanDuration[] = ['hour', 'evening', 'halfday', 'fullday'];
const Companies: PlanCompany[] = ['solo', 'date', 'friends', 'family'];

type PlanCacheEntry = { plan: Plan; expires: number };
type ListCacheEntry = { places: PlaceWithDistance[]; expires: number };

const globalCache = globalThis as {
  planCache?: Map<string, PlanCacheEntry>;
  planListCache?: Map<string, ListCacheEntry>;
};

const PlanTtlMs = 2 * 60 * 60 * 1000;
const ListTtlMs = 10 * 60 * 1000;

const DurationMinutes: Record<PlanDuration, number> = {
  hour: 75,
  evening: 260,
  halfday: 320,
  fullday: 600,
};

const FallbackTitles: Record<PlanDuration, string> = {
  hour: 'An hour nearby',
  evening: 'An evening nearby',
  halfday: 'Half a day nearby',
  fullday: 'A day nearby',
};

async function cachedSearch(
  apiKey: string,
  category: PlaceCategory,
  center: Coordinates,
  origin: string
): Promise<PlaceWithDistance[]> {
  globalCache.planListCache ??= new Map();
  const key = `${center.latitude.toFixed(3)},${center.longitude.toFixed(3)}|${category}`;
  const entry = globalCache.planListCache.get(key);
  if (entry && entry.expires > Date.now()) {
    return entry.places;
  }
  const places = await searchNearby({ apiKey, category, center, origin });
  globalCache.planListCache.set(key, { places, expires: Date.now() + ListTtlMs });
  return places;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = url.searchParams.get('lat') ? Number(url.searchParams.get('lat')) : NaN;
  const lng = url.searchParams.get('lng') ? Number(url.searchParams.get('lng')) : NaN;
  const duration = url.searchParams.get('duration') as PlanDuration;
  const company = url.searchParams.get('company') as PlanCompany;

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    !Durations.includes(duration) ||
    !Companies.includes(company)
  ) {
    return Response.json(
      { error: 'Expected lat, lng, duration (hour|evening|halfday|fullday), company (solo|date|friends|family)' },
      { status: 400 }
    );
  }

  const center = { latitude: lat, longitude: lng };
  const start = new Date();
  const end = new Date(start.getTime() + DurationMinutes[duration] * 60000);

  globalCache.planCache ??= new Map();
  const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)}|${duration}|${company}|${start.toDateString()}|${Math.floor(start.getHours() / 2)}`;
  // fresh=1 is the ↻: skip the cache read (the recompose still writes)
  const fresh = url.searchParams.get('fresh') === '1';
  const cached = fresh ? undefined : globalCache.planCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return Response.json({ plan: cached.plan, cached: true });
  }

  const googleKey = process.env.GOOGLE_PLACES_API_KEY;

  try {
    let pools: CandidatePools;
    let stories: HistoryItem[] = [];
    let rainy = false;
    let weatherNote: string | undefined;

    if (googleKey) {
      const [landmark, food, drink, activity, nearbyStories, weather] = await Promise.all([
        cachedSearch(googleKey, 'landmark', center, url.origin),
        cachedSearch(googleKey, 'food', center, url.origin),
        cachedSearch(googleKey, 'drink', center, url.origin),
        cachedSearch(googleKey, 'activity', center, url.origin),
        findNearbyHistory(center, 1200).catch(() => [] as HistoryItem[]),
        fetchWeatherWindow(center, start, end),
      ]);
      pools = { landmark, food, drink, activity };
      stories = nearbyStories;
      rainy = (weather?.maxPrecipitationChance ?? 0) > 45;
      weatherNote = rainy ? 'bring the umbrella' : undefined;
    } else {
      console.warn('GOOGLE_PLACES_API_KEY not set — composing from mock places (demo mode)');
      pools = {
        landmark: placesByCategory('landmark', center),
        food: placesByCategory('food', center),
        drink: placesByCategory('drink', center),
        activity: placesByCategory('activity', center),
      };
    }

    const solved = solvePlan({ start, duration, company, origin: center, pools, stories, rainy });
    if (!solved) {
      return Response.json(
        { error: 'Not enough open around here to plan right now' },
        { status: 422 }
      );
    }

    // Real walking legs for the spine (estimates stand in on failure),
    // then the in-code revalidation of every window
    if (googleKey) {
      const points = [center, ...solved.stops.map((stop) => stop.coordinates)];
      const routes = await Promise.all(
        solved.legs.map((_, i) =>
          computeWalkingRoute(googleKey, points[i], points[i + 1]).catch(() => null)
        )
      );
      const { valid } = rebaseTimes(
        solved,
        start,
        routes.map((route) => route?.seconds ?? null)
      );
      if (!valid) {
        trimToValid(solved, start);
      }
      routes.forEach((route, i) => {
        if (route && solved.legs[i]) {
          solved.legs[i].meters = route.meters;
        }
      });
    }

    // Claude's voice — strictly optional
    const plan = await annotate(solved, { duration, company, start, rainy, center, weatherNote });

    globalCache.planCache.set(cacheKey, { plan, expires: Date.now() + PlanTtlMs });
    return Response.json({ plan, ...(googleKey ? {} : { demo: true }) });
  } catch (error) {
    console.error('Plan composition failed:', error);
    return Response.json({ error: 'Plan composition failed' }, { status: 502 });
  }
}

/** Drop window-breaking stops (rare: a real leg ran long) and re-base. */
function trimToValid(solved: SolvedPlan, start: Date) {
  for (let guard = 0; guard < 3; guard++) {
    const failing = solved.stops.findIndex((stop) => {
      if (!stop.nextCloseTime) {
        return false;
      }
      return new Date(stop.nextCloseTime) < new Date(stop.arrive);
    });
    if (failing === -1) {
      return;
    }
    solved.stops.splice(failing, 1);
    solved.legs.splice(failing, 1);
    rebaseTimes(solved, start, solved.legs.map(() => null));
  }
}

async function annotate(
  solved: SolvedPlan,
  context: {
    duration: PlanDuration;
    company: PlanCompany;
    start: Date;
    rainy: boolean;
    center: Coordinates;
    weatherNote?: string;
  }
): Promise<Plan> {
  const { duration, company, start, rainy, center, weatherNote } = context;
  const sunset = sunsetAt(center, start);

  const plan: Plan = {
    title: FallbackTitles[duration],
    duration,
    company,
    start: start.toISOString(),
    end: solved.stops[solved.stops.length - 1].depart,
    totalWalkSeconds: solved.legs.reduce((sum, leg) => sum + leg.seconds, 0),
    stops: solved.stops,
    legs: solved.legs,
    note:
      solved.unfilledSlots.length > 0
        ? 'A shorter plan than usual — this area runs thin right now.'
        : undefined,
  };

  if (weatherNote) {
    const longest = plan.legs.reduce((a, b) => (b.seconds > a.seconds ? b : a), plan.legs[0]);
    longest.note = weatherNote;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return plan;
  }

  const brief = JSON.stringify({
    occasion: { duration, company },
    // Local strings only — ISO timestamps invited UTC-shifted phrasing
    conditions: {
      startsAt: shortTime(start),
      rainExpected: rainy,
      sunset: sunset ? shortTime(sunset) : null,
    },
    stops: plan.stops.map((stop, index) => ({
      placeId: stop.placeId,
      order: index + 1,
      name: stop.name,
      kind: stop.slotKind,
      type: stop.primaryLabel,
      rating: stop.rating,
      price: stop.priceLevel,
      arrives: shortTime(new Date(stop.arrive)),
      closes: stop.nextCloseTime ? shortTime(new Date(stop.nextCloseTime)) : null,
    })),
    legs: plan.legs.map((leg, index) => ({
      index,
      minutes: Math.round(leg.seconds / 60),
      passesStory: leg.story?.title ?? null,
    })),
  });

  try {
    const annotations = await fetchPlanAnnotations({ apiKey: anthropicKey, brief });
    if (annotations) {
      plan.title = annotations.title || plan.title;
      for (const stop of plan.stops) {
        stop.why = annotations.whys[stop.placeId];
      }
      for (const [index, note] of Object.entries(annotations.legNotes)) {
        const leg = plan.legs[Number(index)];
        if (leg && !leg.note) {
          leg.note = note;
        }
      }
    }
  } catch (error) {
    console.warn('Plan annotation failed — serving the factual plan:', error);
  }
  return plan;
}
