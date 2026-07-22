import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/api';
import { persistedMap } from '@/data/persisted-cache';
import { HistoryFeed, HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const HourMs = 60 * 60 * 1000;

// Same session-cache pattern as the places list: keyed on the server's
// own ~111m grid (3 dp — see cacheKey), individual items kept for the
// detail screen. Both persist across process death (see
// persisted-cache.ts) BY THE SAME KEYS — the bucket keying is what
// makes persistence safe: movement always lands in a different bucket,
// so a stored list can never be served for the wrong location. TTLs
// govern re-asking about the SAME spot: the list mirrors the server's
// 1h bucket-staleness intent; an older persisted bucket is only ever a
// placeholder (serve-stale-while-revalidate) or an offline fallback,
// never a quiet substitute. Items are content by pageId (not
// location-served), kept a week for the detail screen.
//
// The list persists the whole HistoryFeed — sparse metadata WITH the
// items — so a cache-served or offline-stale feed for a quiet village
// keeps its "we looked further" honesty. Named 'history-feed' (not
// the earlier 'history-list'): the cached-shape ruling from the
// sparse-area change applies to persisted entries identically — a
// bare-array entry predates sparse and must not replay as a feed.
//
// Caps (see persisted-cache's maxEntries): 8 feed buckets is a whole
// walk's worth at 3 dp (~900m of latitude each) while one ~124KB
// Greenwich-sized feed × 8 stays well under Android AsyncStorage's
// ~6MB ceiling; 500 items keeps several walks of detail-screen
// material at ~2KB apiece for ~1MB worst case.
const FeedBucketCap = 8;
const ItemCap = 500;
// v2: items may carry event:true (events-are-history ruling) — a
// pre-flag persisted feed would keep leaking events into Nearby
const listCache = persistedMap<HistoryFeed>('history-feed-v2', HourMs, {
  maxEntries: FeedBucketCap,
});
const itemCache = persistedMap<HistoryItem>('history-item', 7 * 24 * HourMs, {
  maxEntries: ItemCap,
});

// 3 dp ≈ 111m of latitude — the server's own bucket (src/app/api/
// history+api.ts), mirrored so walking mints a new client bucket
// exactly when the server would mint a new answer. (Was 4 dp ≈ 11m: finer than
// the ~10m GPS tick, so every tick minted a bucket — ~90/km, each
// persisting a full ~124KB feed.) Old 4 dp entries can't collide with
// these keys — toFixed(3) and toFixed(4) render disjoint strings — so
// they're simply never hit again and age out via the 2×TTL prune.
function cacheKey(center: Coordinates): string {
  return `${center.latitude.toFixed(3)}|${center.longitude.toFixed(3)}`;
}

export type HistoryFetchResult = HistoryFeed & {
  /** A network failure forced serving saved stories — the UI may say so. */
  stale?: boolean;
  /** Present when items are an expired persisted bucket shown instantly
   * as a placeholder; resolves with the fresh (or offline-stale) result. */
  revalidate?: Promise<HistoryFetchResult>;
};

/** Synchronous probe: does this bucket hold anything to paint right
 * now — a fresh feed or an expired placeholder? useHistory asks it on
 * a bucket change to decide between a seamless handover and an honest
 * loading state. (Before hydration resolves it can under-report;
 * that errs toward a spinner, never toward the wrong area's feed.) */
export function hasCachedFeed(center: Coordinates): boolean {
  return listCache.peek(cacheKey(center)) !== undefined;
}

export type HistoryFetchOptions = {
  /** A deliberate pull: bypass every cache, client and server (fresh=1). */
  forceRefresh?: boolean;
  /** The one-shot dressing upgrade: skip the client cache so the ask
   * reaches the server (whose bucket cache holds the dressed verdict by
   * now), but WITHOUT fresh=1 — never a full upstream recompose. */
  upgrade?: boolean;
};

export async function fetchNearbyHistory(
  center: Coordinates,
  options?: HistoryFetchOptions
): Promise<HistoryFetchResult> {
  const key = cacheKey(center);
  if (!options?.forceRefresh && !options?.upgrade) {
    let cached = listCache.get(key);
    if (cached === undefined) {
      // Cache miss: persisted entries may still be loading — await
      // hydration once, then check again before spending a fetch
      await listCache.hydrated;
      cached = listCache.get(key);
    }
    if (cached) {
      // The stored object itself, not a copy: a repeated hit for the
      // same bucket returns the IDENTICAL result, so useHistory can
      // bail its setState on reference equality. Nothing mutates
      // results downstream — keep it that way.
      return cached;
    }

    // An expired bucket for this exact spot paints instantly while the
    // re-ask runs — a placeholder, not a substitute
    const expired = listCache.peek(key);
    if (expired) {
      return { ...expired.value, revalidate: fetchFresh(center, key, options) };
    }
  }

  return fetchFresh(center, key, options);
}

// In-flight dedupe: both tabs stay mounted and each runs useHistory,
// so entering a fresh bucket fires two identical ~124KB asks at once.
// Keyed on the bucket alone — whichever request started first serves
// every concurrent caller — EXCEPT forceRefresh: a deliberate pull
// must actually reach the network, so it starts its own fetch and
// replaces the entry (a plain caller arriving after that shares the
// refresh; a plain fetch can never downgrade one). Entries clear when
// the request settles, success or failure alike — a failed ask must
// not poison the bucket; the next caller retries.
const inFlight = new Map<string, Promise<HistoryFetchResult>>();

function fetchFresh(
  center: Coordinates,
  key: string,
  options?: HistoryFetchOptions
): Promise<HistoryFetchResult> {
  const pending = inFlight.get(key);
  // Both deliberate re-asks (pull, dressing upgrade) must actually
  // reach the network — an in-flight plain ask may be about to resolve
  // with the very undressed list the upgrade exists to replace
  if (pending && !options?.forceRefresh && !options?.upgrade) {
    return pending;
  }
  const request = requestFeed(center, key, options);
  inFlight.set(key, request);
  const clear = () => {
    // Identity-checked: a forceRefresh may have replaced this entry —
    // an older request settling must not clear the newer one
    if (inFlight.get(key) === request) {
      inFlight.delete(key);
    }
  };
  request.then(clear, clear);
  return request;
}

async function requestFeed(
  center: Coordinates,
  key: string,
  options?: HistoryFetchOptions
): Promise<HistoryFetchResult> {
  const params = new URLSearchParams({
    lat: String(center.latitude),
    lng: String(center.longitude),
  });
  if (options?.forceRefresh) {
    params.set('fresh', '1'); // a deliberate pull must bypass the server's bucket cache too
  }

  try {
    const response = await fetch(apiUrl(`/api/history?${params}`));
    if (!response.ok) {
      throw new Error(`History request failed with status ${response.status}`);
    }

    const body = (await response.json()) as HistoryFeed;
    const feed: HistoryFeed = {
      items: body.items,
      ...(body.sparse ? { sparse: true } : {}),
      // The horizon rides with sparse — and persists with the feed, so
      // an offline-stale sparse bucket keeps saying how far it looked.
      // (Entries persisted before this field simply lack it; the UI
      // falls back to phrasing for the radius they were composed at.)
      ...(body.sparse && typeof body.horizon === 'number' ? { horizon: body.horizon } : {}),
      ...(body.dressing ? { dressing: true } : {}),
    };
    // A dressing:true feed IS persisted — flag included, never as
    // final. The items are real, text-complete stories: offline (or
    // after a force-quit) an undressed list beats an empty screen, and
    // location-first keying still holds. The persisted flag is what
    // keeps it honest — any online session that reads it back sees
    // `dressing` and fires the one-shot upgrade (useHistory), so a
    // flagged bucket can never quietly masquerade as the dressed
    // verdict for its whole TTL.
    listCache.set(key, feed);
    for (const item of body.items) {
      itemCache.set(String(item.pageId), item);
    }
    return feed; // same object the cache holds — see the cache-hit note
  } catch (error) {
    // Offline path: saved stories for this exact bucket (even expired)
    // beat a spinner in a dead zone — sparse honesty riding along. Only
    // real data is ever served: the failure itself is never cached.
    await listCache.hydrated;
    const saved = listCache.peek(key);
    if (saved) {
      return { ...saved.value, stale: true };
    }
    throw error;
  }
}

export function getCachedHistoryItem(pageId: number): HistoryItem | undefined {
  return itemCache.get(String(pageId));
}

/**
 * One story by pageId — the share deep-link cold start, where nothing
 * has populated the session cache yet. Null means the server is sure
 * there is no such story (a true 404); upstream trouble throws so the
 * caller can tell the difference.
 */
export async function fetchStory(pageId: number): Promise<HistoryItem | null> {
  const cached = itemCache.get(String(pageId));
  if (cached) {
    return cached;
  }

  const response = await fetch(apiUrl(`/api/story?pageId=${pageId}`));
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Story request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { item: HistoryItem };
  itemCache.set(String(body.item.pageId), body.item);
  return body.item;
}

/** Stable "no neighbourhood": one shared reference, so render-time
 * callers memoizing on identity never see a fresh [] per call. */
const NoStories: readonly HistoryItem[] = Object.freeze([]);

/**
 * The stories AROUND a story: the items of the cached feed bucket that
 * contains it — its own neighbourhood. The web of history links a
 * story to the stories around it, not to whatever the 500-item store
 * remembers from another town last week — so candidates come from the
 * (at most 8) feed buckets, newest-minted first, expired placeholders
 * included: offline, the feed on screen IS an expired bucket, and its
 * stories keep their doors.
 *
 * Identity contract: the answer is the stored feed's items array
 * ITSELF — a repeated call returns the IDENTICAL array until the
 * bucket is replaced — so render-time derivations (React Compiler)
 * can memoize on reference instead of recomputing the link plan every
 * render. Nothing mutates feed items downstream; keep it that way.
 * A story no cached feed contains (a cold-start deep link) gets the
 * shared empty array: no known neighbourhood, no doors.
 */
export function getStoriesAround(pageId: number): readonly HistoryItem[] {
  const feeds = listCache.peekValues();
  // Reversed: insertion order tracks minting order, so the last bucket
  // is the one nearest to where the user is walking now
  for (let index = feeds.length - 1; index >= 0; index--) {
    const { items } = feeds[index];
    if (items.some((item) => item.pageId === pageId)) {
      return items;
    }
  }
  return NoStories;
}

/** Test seam. */
export function cacheHistoryItems(items: HistoryItem[]) {
  for (const item of items) {
    itemCache.set(String(item.pageId), item);
  }
}
