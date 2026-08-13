import { AskForLocation, OpenSettings } from '@/components/location-ask';
import { PointerDial } from '@/components/pointer-dial';
import { useLocation, useSlowFix } from '@/hooks/use-location';
import { bearingDegrees, compassPoint, Coordinates, distanceMeters } from '@/utils/geo';
import { formatDistance } from '@/utils/format';

type Props = {
  target: Coordinates;
};

/** Within arm's reach the compass stops pointing and says so. */
const ArrivedMeters = 15;

/** As-the-crow-flies pointer: needle at the destination, live distance. */
export function Compass({ target }: Props) {
  const { status, coordinates } = useLocation();
  // A granted permission with no fix waits exactly as forever as a
  // denied one did, so the wait gets a floor (#290)
  const slowFix = useSlowFix(!coordinates && status !== 'denied' && status !== 'priming');

  if (!coordinates) {
    // The dial stands while GPS wakes — a blank modal read as broken
    // (mock direction A, "the blank void dies"). Needle stays hidden:
    // with no position there is no bearing to point along. Neither
    // no-fix state is "waiting": each says what would fix it, and each
    // gets the remedy that actually works for it.
    if (status === 'denied') {
      return (
        <>
          <PointerDial
            user={target}
            target={target}
            primary="Location off"
            locating
            coach="Venture can’t see where you are"
          />
          <OpenSettings />
        </>
      );
    }
    // Never asked: iOS will still show its own prompt, and Settings
    // has no Location row for an app that has never requested one —
    // so the door here is the ask, not Settings
    if (status === 'priming') {
      return (
        <>
          <PointerDial
            user={target}
            target={target}
            primary="Not shared"
            locating
            coach="Venture hasn’t asked where you are"
          />
          <AskForLocation />
        </>
      );
    }
    if (slowFix) {
      return (
        <PointerDial
          user={target}
          target={target}
          primary="No fix yet"
          locating
          coach="Still looking — indoors this can take a while"
        />
      );
    }
    return <PointerDial user={target} target={target} primary="Finding you…" locating />;
  }

  const distance = distanceMeters(coordinates, target);
  const arrived = distance < ArrivedMeters;

  return (
    <PointerDial
      user={coordinates}
      target={target}
      primary={formatDistance(distance)}
      secondary={arrived ? 'here' : `away · ${compassPoint(bearingDegrees(coordinates, target))}`}
      arrived={arrived}
    />
  );
}
