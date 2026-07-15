import { PointerDial } from '@/components/pointer-dial';
import { useLocation } from '@/hooks/use-location';
import { Coordinates, distanceMeters } from '@/utils/geo';
import { formatDistance } from '@/utils/format';

type Props = {
  target: Coordinates;
};

/** As-the-crow-flies pointer: needle at the destination, live distance. */
export function Compass({ target }: Props) {
  const { coordinates } = useLocation();

  if (!coordinates) {
    return null; // no position -> neither direction nor distance to show
  }

  return (
    <PointerDial
      user={coordinates}
      target={target}
      primary={formatDistance(distanceMeters(coordinates, target))}
      secondary="away"
    />
  );
}
