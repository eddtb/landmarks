import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';

/**
 * The shared spine of the SIMPLE data clients: session cache in front
 * of one API call — cached answer, or fetch, throw on a non-OK
 * status, unwrap the payload, remember it. Extracted (#199) from the
 * retold/route/telling clients, whose only real differences are the
 * key, the payload shape, and the unwrap — all of which stay visible
 * at the call site. `init` exists for POST transports (the telling).
 *
 * Deliberately NOT used by:
 * - history-client: its cache→fetch has grown real machinery
 *   (persisted feeds, in-flight dedupe, the dressing upgrade,
 *   offline-stale fallbacks) that a generic helper would flatten;
 * - fetchArticle: persisted cache with hydration await and an
 *   offline "expired beats nothing" peek — its own policy;
 * - fetchArticleLight: deliberately never caches (a light article
 *   cached would hide the gallery behind it) — no cache, no helper.
 *
 * Error policy is throw-only, as an ApiError carrying the HTTP
 * status: a caller with a softer policy (fetchArticleMinutes returns
 * null when the server can't answer) catches it EXPLICITLY, so the
 * drift the debt audit found becomes a visible decision instead of a
 * seventh copy of the idiom.
 */

export class ApiError extends Error {
  constructor(
    label: string,
    readonly status: number
  ) {
    super(`${label} request failed with status ${status}`);
    this.name = 'ApiError';
  }
}

export async function cachedGet<Key, Body, Value>(options: {
  cache: { get(key: Key): Value | undefined; set(key: Key, value: Value): void };
  key: Key;
  /** API path relative to the app origin, e.g. `/api/route?...`. */
  path: string;
  /** Error-message prefix: "Route" → "Route request failed with status 502". */
  label: string;
  /** POST transports only; omit for a plain GET. */
  init?: Parameters<typeof fetch>[1];
  /** Payload → value: unwrapping AND any boundary normalisation. */
  unwrap: (body: Body) => Value;
}): Promise<Value> {
  const { cache, key, path, label, init, unwrap } = options;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(apiUrl(path), init);
  if (!response.ok) {
    throw new ApiError(label, response.status);
  }
  const value = unwrap((await response.json()) as Body);
  cache.set(key, value);
  return value;
}
