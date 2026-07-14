import { useState } from 'react';

import { Coordinates, distanceMeters } from '@/utils/geo';

const RefetchThresholdMeters = 250;

/**
 * Live GPS updates arrive every ~10m, but refetching Google on each step
 * would be wasteful. The anchor is the position we last searched from;
 * it only moves once the user has walked far enough that new places
 * could plausibly appear. Distances still tick live — they're computed
 * client-side against the real position.
 */
export function useFetchAnchor(coordinates: Coordinates): Coordinates {
  const [anchor, setAnchor] = useState(coordinates);

  if (distanceMeters(anchor, coordinates) > RefetchThresholdMeters) {
    setAnchor(coordinates);
  }

  return anchor;
}
