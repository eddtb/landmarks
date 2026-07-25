import { PointerDial } from '@/components/pointer-dial';
import { useLocation } from '@/hooks/use-location';
import { bearingDegrees, compassPoint, Coordinates, distanceMeters } from '@/utils/geo';
import { formatDistance } from '@/utils/format';

type Props = {
  target: Coordinates;
};

/** Within arm's reach the compass stops pointing and says so. */
const ArrivedMeters = 15;

/** As-the-crow-flies pointer: needle at the destination, live distance. */
export function Compass({ target }: Props) {
  const { coordinates } = useLocation();

  if (!coordinates) {
    // The dial stands while GPS wakes — a blank modal read as broken
    // (mock direction A, "the blank void dies"). Needle stays hidden:
    // with no position there is no bearing to point along.
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
