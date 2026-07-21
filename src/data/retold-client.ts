import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';

export type RetoldPart = { heading: string; body: string; pullQuote?: string };
export type TimelineStop = { year: string; label: string; part: number };
export type Retold = { parts: RetoldPart[]; minutes: number; timeline: TimelineStop[] };

const cache = new Map<string, Retold>();

export async function fetchRetold(areaName: string): Promise<Retold> {
  const key = areaName.toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const response = await fetch(apiUrl(`/api/retold?area=${encodeURIComponent(areaName)}`));
  if (!response.ok) {
    throw new Error(`Retold request failed with status ${response.status}`);
  }
  const body = (await response.json()) as { retold: Retold };
  // Normalise at the boundary: a server mid-deploy (or an old cached
  // shape) may lack fields the UI renders — never let it crash a screen
  const retold: Retold = {
    parts: body.retold.parts ?? [],
    minutes: body.retold.minutes ?? 1,
    timeline: body.retold.timeline ?? [],
  };
  cache.set(key, retold);
  return retold;
}
