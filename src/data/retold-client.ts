import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';

export type RetoldPart = { heading: string; body: string };
export type Retold = { parts: RetoldPart[]; minutes: number };

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
  cache.set(key, body.retold);
  return body.retold;
}
