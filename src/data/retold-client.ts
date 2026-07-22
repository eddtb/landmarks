import { cachedGet } from '@/data/cached-get';
import { Retold } from '@/types/retold';

const cache = new Map<string, Retold>();

export async function fetchRetold(areaName: string): Promise<Retold> {
  return cachedGet({
    cache,
    key: areaName.toLowerCase(),
    path: `/api/retold?area=${encodeURIComponent(areaName)}`,
    label: 'Retold',
    // Normalise at the boundary: a server mid-deploy (or an old cached
    // shape) may lack fields the UI renders — never let it crash a screen
    unwrap: (body: { retold: Retold }): Retold => ({
      parts: body.retold.parts ?? [],
      minutes: body.retold.minutes ?? 1,
      timeline: body.retold.timeline ?? [],
    }),
  });
}
