import { AppleMaps, GoogleMaps } from 'expo-maps';
import { Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WalkingRoute } from '@/types/route';
import { Coordinates } from '@/utils/geo';
import { cameraForRoute } from '@/utils/route-camera';

const RouteWidth = 4;

/** The step geometry as one continuous line: first start, then each end. */
export function routePolylinePoints(route: WalkingRoute): Coordinates[] {
  const points: Coordinates[] = [];
  for (const step of route.steps) {
    if (points.length === 0 && step.start) {
      points.push(step.start);
    }
    if (step.end) {
      points.push(step.end);
    }
  }
  return points;
}

type Props = {
  route: WalkingRoute;
  destination: Coordinates;
};

/**
 * The whole walk as a line on a native map — Apple Maps on iOS, Google
 * Maps on Android, both free at any usage. Renders nothing for routes
 * without step geometry (the step list still works without us).
 */
export function RouteMap({ route, destination }: Props) {
  const theme = useTheme();
  const points = routePolylinePoints(route);
  if (points.length < 2) {
    return null;
  }

  const camera = cameraForRoute([...points, destination]);
  // The accent IS the route colour — the map draws the brand
  const polyline = { coordinates: points, color: theme.accent, width: RouteWidth };

  return (
    <View style={styles.frame} testID="route-map">
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
  map: {
    flex: 1,
  },
});
