import { Coordinates } from '@/utils/geo';

/**
 * Reading query parameters the way a route must read them: absence is
 * not zero.
 *
 * `Number.isFinite(Number(param))` looks like a guard and is only half
 * of one. It rejects garbage — `Number('abc')` is `NaN` — but
 * `Number(null)` is `0`, `Number('')` is `0` and `Number(' ')` is `0`,
 * and zero is perfectly finite. So a request with NO coordinates at
 * all resolved to (0, 0): Null Island, in the Gulf of Guinea, which
 * /api/area duly composed and cached as a legitimate area (#305). The
 * failure that gets missed is never the shouted one; it is the one
 * that answers plausibly.
 *
 * Presence is therefore checked before coercion, here, once, for every
 * route that takes a number off a URL.
 */
export function numberParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A pair of coordinate parameters, or null when either is missing or
 * is not a number. Callers answer 400 — a wrong answer is worse than
 * an error, because nothing reports it.
 */
export function coordinatesParam(
  params: URLSearchParams,
  latName = 'lat',
  lngName = 'lng'
): Coordinates | null {
  const latitude = numberParam(params, latName);
  const longitude = numberParam(params, lngName);
  if (latitude === null || longitude === null) {
    return null;
  }
  return { latitude, longitude };
}
