import { Coordinates } from '@/utils/geo';

/**
 * Open-Meteo: free, keyless, one call — the plan's sky input. Only
 * what composition needs: will it rain in the window, roughly how
 * warm. Cached an hour per rounded location on globalThis (the dev
 * server re-evaluates route modules per request).
 */
export type WeatherWindow = {
  /** Max precipitation probability (%) across the plan window. */
  maxPrecipitationChance: number;
  /** Air temperature around the window's start, °C. */
  temperature: number | null;
};

type CacheEntry = { forecast: HourlyForecast; expires: number };
type HourlyForecast = { time: string[]; precipitation_probability?: number[]; temperature_2m?: number[] };

const globalCache = globalThis as { weatherCache?: Map<string, CacheEntry> };

function cache(): Map<string, CacheEntry> {
  globalCache.weatherCache ??= new Map();
  return globalCache.weatherCache;
}

const TtlMs = 60 * 60 * 1000;

export async function fetchWeatherWindow(
  coordinates: Coordinates,
  start: Date,
  end: Date
): Promise<WeatherWindow | null> {
  const key = `${coordinates.latitude.toFixed(2)},${coordinates.longitude.toFixed(2)}`;
  let entry = cache().get(key);
  if (!entry || entry.expires < Date.now()) {
    try {
      const url =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}` +
        '&hourly=precipitation_probability,temperature_2m&forecast_days=2&timezone=auto';
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { hourly?: HourlyForecast };
      if (!body.hourly?.time) {
        return null;
      }
      entry = { forecast: body.hourly, expires: Date.now() + TtlMs };
      cache().set(key, entry);
    } catch {
      // The sky input is garnish — a plan without it is still a plan
      return null;
    }
  }

  const { time, precipitation_probability, temperature_2m } = entry.forecast;
  let maxPrecipitationChance = 0;
  let temperature: number | null = null;
  for (let i = 0; i < time.length; i++) {
    const hour = new Date(time[i]);
    if (hour >= start && hour <= end) {
      maxPrecipitationChance = Math.max(maxPrecipitationChance, precipitation_probability?.[i] ?? 0);
      temperature ??= temperature_2m?.[i] ?? null;
    }
  }
  return { maxPrecipitationChance, temperature };
}
