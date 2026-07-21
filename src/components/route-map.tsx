import { AppleMaps, GoogleMaps } from 'expo-maps';
import { Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { WalkingRoute } from '@/data/route-client';
import { useTheme } from '@/hooks/use-theme';
import { Coordinates } from '@/utils/geo';
import { cameraForRoute } from '@/utils/route-camera';

const RouteWidth = 4;

type Props = {
  route: WalkingRoute;
  destination: Coordinates;
  /** Go mode: fill the screen instead of the 220px card. */
  fullscreen?: boolean;
};

/**
 * The whole walk as a line on a native map — the venue-era component,
 * back with Valhalla shape points instead of Google steps. Renders
 * nothing for routes without geometry (guidance still works without us).
 */
export function RouteMap({ route, destination, fullscreen }: Props) {
  const theme = useTheme();
  const points = route.coordinates;
  if (points.length < 2) {
    return null;
  }

  const camera = cameraForRoute([...points, destination]);
  // The accent IS the route colour — the map draws the brand
  const polyline = { coordinates: points, color: theme.accent, width: RouteWidth };

  return (
    <View style={fullscreen ? styles.full : styles.frame} testID="route-map">
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          style={styles.map}
          cameraPosition={camera ?? undefined}
          polylines={[polyline]}
          markers={[{ coordinates: destination }]}
          properties={{ isMyLocationEnabled: true }}
        />
      ) : (
        <GoogleMaps.View
          style={styles.map}
          cameraPosition={camera ?? undefined}
          polylines={[polyline]}
          markers={[{ coordinates: destination }]}
          properties={{ isMyLocationEnabled: true }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: 220,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  full: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
