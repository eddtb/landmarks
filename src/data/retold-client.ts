import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { ApiError } from '@/data/cached-get';
import { makeSseFrameReader } from '@/data/sse';
import { Retold, RetoldPart } from '@/types/retold';

/**
 * The retold client: session cache in front of ONE ask — but the ask
 * now has two transports, which is why cachedGet no longer fits. A
 * server cache hit answers as JSON, exactly as before. A cold
 * generation answers as an SSE stream: `onPart` fires as each part
 * completes so the gazetteer can render the story while the model is
 * still writing it, and only the FINISHED telling is remembered — an
 * interrupted stream caches nothing here, mirroring the server.
 */

const cache = new Map<string, Retold>();

/** The stream broke after `parts` complete parts — retry re-asks whole. */
export class RetoldInterruptedError extends Error {
  constructor(readonly parts: number) {
    super(`Retelling interrupted after ${parts} parts`);
    this.name = 'RetoldInterruptedError';
  }
}

// Normalise at the boundary: a server mid-deploy (or an old cached
// shape) may lack fields the UI renders — never let it crash a screen
const normalise = (retold: Retold): Retold => ({
  parts: retold.parts ?? [],
  minutes: retold.minutes ?? 1,
  timeline: retold.timeline ?? [],
});

export async function fetchRetold(
  areaName: string,
  onPart?: (part: RetoldPart, index: number) => void
): Promise<Retold> {
  const key = areaName.toLowerCase();
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const response = await fetch(apiUrl(`/api/retold?area=${encodeURIComponent(areaName)}`), {
    headers: { Accept: 'text/event-stream, application/json' },
  });
  if (!response.ok) {
    throw new ApiError('Retold', response.status);
  }

  // Optional-chained: wire-level test doubles (and any odd proxy)
  // may answer without headers — JSON is the default read then
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
    const value = normalise(((await response.json()) as { retold: Retold }).retold);
    cache.set(key, value);
    return value;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new RetoldInterruptedError(0);
  }
  const frames = makeSseFrameReader();
  const bytes = new TextDecoder();
  let arrived = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    for (const frame of frames.feed(bytes.decode(value, { stream: true }))) {
      if (frame.event === 'part') {
        const { index, part } = JSON.parse(frame.data) as { index: number; part: RetoldPart };
        arrived = Math.max(arrived, index + 1);
        onPart?.(part, index);
      } else if (frame.event === 'done') {
        const finished = normalise((JSON.parse(frame.data) as { retold: Retold }).retold);
        cache.set(key, finished);
        return finished;
      } else if (frame.event === 'failed') {
        // In-band failure: what arrived stays rendered; nothing cached
        throw new RetoldInterruptedError(arrived);
      }
    }
  }
  // The connection closed without a verdict — an interruption too
  throw new RetoldInterruptedError(arrived);
}
