import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchNearbyHistory, hasCachedFeed, HistoryFetchResult } from '@/data/history-client';
import { LoadVerdict, loadVerdict } from '@/data/load-verdict';
import { anchorFeedOrigin, useFeedOrigin } from '@/hooks/use-feed-origin';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

export type HistoryState =
  | { status: 'loading' }
  /** Why it failed, so the screen can say what came back rather than
   * "right now" (#291). Never 'absent': a feed has no 404. */
  | { status: 'error'; verdict: LoadVerdict }
  | {
      status: 'ready';
      items: HistoryItem[];
      sparse?: boolean;
      /** Meters the sparse search actually reached — the copy's truth. */
      horizon?: number;
      stale?: boolean;
      /** When the saved copy being served was written. */
      savedAt?: number;
    };

/** How long the server's photo leg gets before the one-shot upgrade
 * re-ask — comfortably past dressWithPhotos' 1.5s response deadline. */
const DressingUpgradeDelayMs = 4000;

/**
 * A null center means Venture has no honest place to ask about — no
 * fix and no pin — and nothing is spent finding out: no fetch, no
 * revalidate, no upgrade timer. The state stays `loading` and callers
 * must render their own no-location answer BEFORE reading it (#289:
 * the feed used to ask about Charing Cross on everyone's behalf).
 *
 * The fetch keys off the feed ORIGIN, not the centre (#323): the
 * centre moves with every ~10m GPS tick and used to refire a whole
 * feed fetch per ~111m bucket it crossed — a re-ask every ~8s on a
 * bus. The origin moves only on a deliberate act (see use-feed-origin
 * for which acts), so movement alone can never fire a fetch from
 * here. The raw center keeps flowing to standing-on/distance labels
 * in the components untouched — stories hold still, distances don't.
 */
export function useHistory(center: Coordinates | null): {
  state: HistoryState;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<HistoryState>({ status: 'loading' });
  const origin = useFeedOrigin(center);
  // Quantized to the server's own 3 dp bucket (~111m), as the centre
  // always was — the server never sees the raw fix.
  const latitude = origin === null ? null : Number(origin.latitude.toFixed(3));
  const longitude = origin === null ? null : Number(origin.longitude.toFixed(3));
  const requestId = useRef(0);
  // The dressing upgrade: EXACTLY one delayed re-ask per origin (or per
  // pull) — `done` stops a still-dressing upgrade result from
  // scheduling another, so there is no poll loop; the timer dies with
  // the origin (effect cleanup) and with a pull (the pull's own re-run
  // resets both). Movement no longer touches it either way.
  const upgradeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const upgradeDone = useRef(false);
  const clearUpgrade = useCallback(() => {
    if (upgradeTimer.current) {
      clearTimeout(upgradeTimer.current);
      upgradeTimer.current = null;
    }
  }, []);

  // An expired persisted bucket paints instantly as a placeholder; the
  // fresh answer (or the offline-stale flag) follows when it lands.
  // Both honesty flags ride through: sparse (the server looked further)
  // and stale (a network failure forced serving saved stories).
  //
  // Same answer, same state: a repeated bucket hit returns the cache's
  // own result object (see history-client), so identical items + flags
  // bail out of setState instead of re-rendering the feed every tick.
  const applyResult = useCallback(
    async (id: number, result: HistoryFetchResult, bucket: Coordinates) => {
      const apply = (next: HistoryFetchResult) => {
        setState((prev) =>
          prev.status === 'ready' &&
          prev.items === next.items &&
          prev.sparse === next.sparse &&
          prev.horizon === next.horizon &&
          prev.stale === next.stale &&
          prev.savedAt === next.savedAt
            ? prev
            : {
                status: 'ready',
                items: next.items,
                sparse: next.sparse,
                horizon: next.horizon,
                stale: next.stale,
                savedAt: next.savedAt,
              }
        );
        // A dressing feed (fresh from the server, or a persisted flagged
        // bucket surviving a relaunch) gets its ONE upgrade re-ask: the
        // server's photo leg has landed by then, so the same bucket
        // answers dressed and the new items replace these (the identical-
        // items bail can't swallow it — dressed items are a new array).
        // If the upgrade itself still comes back dressing, it stands
        // until the origin moves or the user pulls — never a loop.
        if (next.dressing && !upgradeDone.current && id === requestId.current) {
          upgradeDone.current = true;
          upgradeTimer.current = setTimeout(() => {
            upgradeTimer.current = null;
            fetchNearbyHistory(bucket, { upgrade: true }).then(
              (upgraded) => {
                if (id === requestId.current) {
                  apply(upgraded); // still-dressing? upgradeDone blocks a second timer
                }
              },
              () => {
                // Offline or wobbling: the undressed list stands
              }
            );
          }, DressingUpgradeDelayMs);
        }
      };
      if (id === requestId.current) {
        apply(result);
      }
      if (result.revalidate) {
        try {
          const fresh = await result.revalidate;
          if (id === requestId.current) {
            apply(fresh);
          }
        } catch {
          // Nothing newer to show — the placeholder stands
        }
      }
    },
    []
  );

  // The pull's claim on a bucket: when refresh() re-anchors the
  // origin, THIS instance's fetch effect refires for ground the pull
  // is already fetching — the claim tells it to stand down, once.
  const lastAskedBucket = useRef<string | null>(null);
  const pullInFlight = useRef(false);
  const latestCenter = useRef(center);
  useEffect(() => {
    latestCenter.current = center;
  }, [center]);

  useEffect(() => {
    if (latitude === null || longitude === null) {
      return;
    }
    // A moved pull re-anchored the origin and is already asking about
    // exactly this ground — a second ask here would race it for
    // requestId and double the spend. The cleanup still returns: the
    // NEXT origin move must cancel the pull's upgrade like any other.
    const bucket = `${latitude},${longitude}`;
    const pullOwnsThisGround = pullInFlight.current && lastAskedBucket.current === bucket;
    if (!pullOwnsThisGround) {
      const id = ++requestId.current;
      lastAskedBucket.current = bucket;
      // Loading honesty on an origin jump (a pin, mostly): if the new
      // ground has nothing cached the old area's feed — old-area
      // distances and all — must not keep painting under the new
      // header for the fetch window. A cached bucket (revisits) still
      // hands over seamlessly, no flash.
      (async () => {
        if (!hasCachedFeed({ latitude, longitude })) {
          setState((prev) => (prev.status === 'loading' ? prev : { status: 'loading' }));
        }
        try {
          const result = await fetchNearbyHistory({ latitude, longitude });
          await applyResult(id, result, { latitude, longitude });
        } catch (error) {
          console.warn('Failed to load history:', error);
          if (id === requestId.current) {
            setState({ status: 'error', verdict: loadVerdict(error) });
          }
        }
      })();
    }
    // A new origin cancels the pending upgrade — the new ask earns
    // its own — and re-arms the one-shot for the next visit
    return () => {
      clearUpgrade();
      upgradeDone.current = false;
    };
  }, [latitude, longitude, applyResult, clearUpgrade]);

  // The pull: re-anchor to where the reader is NOW — the one promise
  // the margin line makes ("pull down for here") — and ask directly.
  // Unmoved ground is the deliberate everything-bypass (fresh=1);
  // moved ground is a fresh ask about a place the server was never
  // asked about, exactly like app start's, so no fresh=1 recompose.
  const refresh = useCallback(async () => {
    const here = latestCenter.current;
    if (here === null) {
      return;
    }
    const bucket = {
      latitude: Number(here.latitude.toFixed(3)),
      longitude: Number(here.longitude.toFixed(3)),
    };
    const key = `${bucket.latitude},${bucket.longitude}`;
    const moved = lastAskedBucket.current !== key;
    const id = ++requestId.current;
    // Claim the ground BEFORE re-anchoring: the anchor move refires
    // the effect above synchronously after this handler, and it must
    // find the ask already owned
    lastAskedBucket.current = key;
    pullInFlight.current = true;
    // A pull is a fresh compose: drop any pending upgrade and let the
    // pull's own result schedule a new one if it arrives undressed
    clearUpgrade();
    upgradeDone.current = false;
    anchorFeedOrigin(here);
    try {
      const result = moved
        ? await fetchNearbyHistory(bucket)
        : await fetchNearbyHistory(bucket, { forceRefresh: true });
      await applyResult(id, result, bucket);
    } catch (error) {
      console.warn('Failed to refresh history:', error);
      if (id === requestId.current) {
        setState({ status: 'error', verdict: loadVerdict(error) });
      }
    } finally {
      pullInFlight.current = false;
    }
  }, [applyResult, clearUpgrade]);

  return { state, refresh };
}
