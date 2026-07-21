import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCachedHistoryItem } from '@/data/history-client';
import { fetchRoute, WalkingRoute } from '@/data/route-client';
import { useLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { formatDistance, formatWalkTime } from '@/utils/format';
import { distanceMeters } from '@/utils/geo';
import { metersFromRoute, upcomingManeuver } from '@/utils/navigation';

/**
 * Go: the finding map. You, the story, and the streets between —
 * Apple's native map (free; the module has been aboard since PR #50),
 * a violet straight line for bearing, and the live distance counting
 * down as you walk. No routing engine: the Google one billed per
 * open, and for sub-walk distances the streets on screen ARE the
 * route. Android's map needs a key we don't have — it keeps the
 * compass dial instead.
 */

// Native module: guarded like every other one
const Maps = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-maps') as typeof import('expo-maps');
  } catch {
    return null;
  }
})();

/** Fit both ends of the walk: farther apart → wider camera. */
export function zoomFor(meters: number): number {
  if (meters <= 0) {
    return 17;
  }
  return Math.min(17, Math.max(12, 17 - Math.log2(meters / 150)));
}

export default function GoScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));
  const theme = useTheme();
  const { coordinates } = useLocation();
  const [route, setRoute] = useState<WalkingRoute | null>(null);

  // A route when there is none, a new one at >30m drift; GPS breathing
  // inside the corridor never refetches (and the server's ~27m origin
  // bucket makes most refetches cache hits anyway)
  useEffect(() => {
    if (!coordinates || !item) {
      return;
    }
    if (route && metersFromRoute(route.coordinates, coordinates) <= 30) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const fresh = await fetchRoute(coordinates, item.coordinates);
        if (active) {
          setRoute(fresh);
        }
      } catch {
        // The straight line stands in; the next position change retries
      }
    })();
    return () => {
      active = false;
    };
  }, [coordinates, item, route]);

  if (!item) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: 'Go' }} />
        <ThemedText themeColor="textSecondary">This story could not be found.</ThemedText>
      </ThemedView>
    );
  }

  const meters = coordinates ? distanceMeters(coordinates, item.coordinates) : null;
  const next =
    route && coordinates ? upcomingManeuver(route.coordinates, route.maneuvers, coordinates) : null;
  const AppleMapView = Platform.OS === 'ios' ? Maps?.AppleMaps.View : null;

  const midpoint = coordinates
    ? {
        latitude: (coordinates.latitude + item.coordinates.latitude) / 2,
        longitude: (coordinates.longitude + item.coordinates.longitude) / 2,
      }
    : item.coordinates;

  return (
    <ThemedView style={styles.container}>
      {AppleMapView ? (
        <AppleMapView
          style={styles.map}
          cameraPosition={{ coordinates: midpoint, zoom: zoomFor(meters ?? 300) }}
          properties={{ isMyLocationEnabled: true }}
          markers={[
            {
              id: 'story',
              coordinates: item.coordinates,
              title: item.title,
              tintColor: theme.accent,
              systemImage: 'book.fill',
            },
          ]}
          polylines={
            route
              ? [{ id: 'route', coordinates: route.coordinates, color: theme.accent, width: 5 }]
              : coordinates
                ? [
                    {
                      id: 'bearing',
                      coordinates: [coordinates, item.coordinates],
                      color: theme.accent,
                      width: 4,
                    },
                  ]
                : []
          }
        />
      ) : (
        <View style={styles.centered}>
          <ThemedText type="small" themeColor="textSecondary" style={styles.fallback}>
            The map needs iOS for now — the compass knows the way on every platform.
          </ThemedText>
        </View>
      )}
      <View style={[styles.footer, { backgroundColor: theme.background }]}>
        <View style={styles.footerText}>
          <ThemedText type="headline" numberOfLines={2}>
            {next ? next.instruction : item.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {next && next.metersUntil > 0
              ? `in ${formatDistance(next.metersUntil)} · ` +
                `${formatDistance(route!.meters)} · ${formatWalkTime(route!.seconds)}`
              : route
                ? `${formatDistance(route.meters)} · ${formatWalkTime(route.seconds)}`
                : meters !== null
                  ? `${formatDistance(meters)} · ${formatWalkTime(Math.round(meters / 1.33))}`
                  : 'Finding you…'}
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.replace({
              pathname: '/history/[pageId]/compass',
              params: { pageId: String(item.pageId) },
            })
          }
          style={({ pressed }) => [
            styles.compassButton,
            { backgroundColor: theme.accentSoft },
            pressed && { opacity: 0.85 },
          ]}>
          <ThemedText type="smallBold" themeColor="accent">
            Compass ›
          </ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    textAlign: 'center',
    paddingHorizontal: Spacing.six,
  },
  map: {
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.five,
  },
  footerText: {
    flex: 1,
    gap: 2,
  },
  compassButton: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
});
