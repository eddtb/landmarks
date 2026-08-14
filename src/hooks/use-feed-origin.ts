import { useEffect, useRef, useSyncExternalStore } from 'react';

import { usePin } from '@/hooks/use-pin';
import { feedBucketKey } from '@/types/history';
import { Coordinates } from '@/utils/geo';

/**
 * WHERE THE FEED WAS ASKED FROM — one origin for the whole app.
 *
 * The feed used to follow the reader: every ~111m bucket the GPS
 * crossed refired a full feed fetch, which at walking pace was a
 * re-ask every ~90s and on a bus was one every ~8s, the map
 * re-cameraing and the title moving with it (#323, Edd's device). The
 * reader decides when the feed re-asks now: it anchors where the app
 * learns their position, and moves only on a deliberate act — a
 * pull-to-refresh, a searched pin, "Back to near me". Movement never
 * moves it, at any speed.
 *
 * Module store on the use-pin primitive (a value, a listener set,
 * useSyncExternalStore), and for use-pin's own reason: the feed list,
 * the count line, the gazetteer and the quiz each run their own
 * useHistory, and surfaces that disagreed on where the stories were
 * asked from would be describing different feeds. A pull on any one of
 * them re-anchors every one of them.
 *
 * The origin is the RAW fix, not the bucket: the margin's moved-since
 * measure and the map camera want the honest point; useHistory
 * quantizes to the server's 3 dp bucket itself, exactly as it always
 * quantized the centre.
 */
let origin: Coordinates | null = null;
const listeners = new Set<() => void>();

/**
 * Move the feed's origin — a deliberate act only. useFeedOrigin calls
 * it when the app first learns where the reader is and when the pin
 * changes hands; useHistory's refresh calls it so a pull re-asks from
 * where the reader is NOW, which is the promise the margin line makes.
 */
export function anchorFeedOrigin(next: Coordinates) {
  if (origin && origin.latitude === next.latitude && origin.longitude === next.longitude) {
    return;
  }
  origin = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return origin;
}

/** Tests only: the store is module-level and must not leak between them. */
export function resetFeedOriginForTests() {
  origin = null;
}

/**
 * The feed's origin for a screen whose centre is `center`. Null when
 * the centre is null — no honest place, nothing anchored, nothing
 * spent (#289's contract, kept).
 *
 * The anchor moves when:
 * - the app FIRST learns where the reader is (mount with an empty
 *   store, or a centre arriving after none — app start, a permission
 *   granted mid-session, a blind pin's GPS landing);
 * - the centre IS the pin (bucket-compared, the useAreaName
 *   precedent): a pin is the reader choosing a place, and every pin
 *   move is deliberate;
 * - the pin lets go ("Back to near me", a blind pin self-releasing):
 *   returning to real ground is as deliberate as leaving it was.
 *
 * A GPS tick is none of those. The effect refires per tick and bails.
 */
export function useFeedOrigin(center: Coordinates | null): Coordinates | null {
  const pin = usePin();
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const pinned =
    center !== null &&
    pin !== null &&
    feedBucketKey(center.latitude, center.longitude) ===
      feedBucketKey(pin.center.latitude, pin.center.longitude);
  const wasPinned = useRef(pinned);
  const hadCenter = useRef(center !== null);

  useEffect(() => {
    const left = wasPinned.current && !pinned;
    const arrived = !hadCenter.current && center !== null;
    wasPinned.current = pinned;
    hadCenter.current = center !== null;
    if (center === null) {
      return;
    }
    if (pinned || left || arrived || getSnapshot() === null) {
      anchorFeedOrigin(center);
    }
  }, [center, pinned]);

  return center === null ? null : stored;
}
