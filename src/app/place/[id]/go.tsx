import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Compass } from '@/components/compass';
import { RouteMap } from '@/components/route-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchWalkingRoute } from '@/data/route-client';
import { useLocation } from '@/hooks/use-location';
import { usePlaceDetails } from '@/hooks/use-place-details';
import { useTheme } from '@/hooks/use-theme';
import { WalkingRoute } from '@/types/route';
import { formatDistance, formatWalkTime } from '@/utils/format';
import { guidanceFor } from '@/utils/guidance';

type Mode = 'route' | 'compass';

/**
 * Go mode: the whole screen is the journey. Route view is the map
 * with the live step in a floating sheet; Compass view is the dial
 * for the point-and-wander mood. Everything else stays behind on the
 * venue screen — this screen answers exactly one question.
 */
export default function GoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  const place = state.status === 'ready' ? state.details : summary;
  const { coordinates } = useLocation();
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('route');
  const [stepsOpen, setStepsOpen] = useState(false);
  const [routeState, setRouteState] = useState<
    { status: 'loading' } | { status: 'none' } | { status: 'ready'; route: WalkingRoute }
  >({ status: 'loading' });

  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;
  const target = place?.coordinates;

  useEffect(() => {
    if (latitude === undefined || longitude === undefined || !target) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const route = await fetchWalkingRoute({ latitude, longitude }, target);
        if (!cancelled) {
          setRouteState(route ? { status: 'ready', route } : { status: 'none' });
        }
      } catch (error) {
        console.warn('Failed to load route:', error);
        if (!cancelled) {
          setRouteState({ status: 'none' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, target]);

  if (!place || !coordinates) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator />
      </ThemedView>
    );
  }

  const route = routeState.status === 'ready' ? routeState.route : null;
  const guidance = route ? guidanceFor(route, coordinates) : null;
  const showMap = mode === 'route' && route;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {showMap ? (
        <RouteMap route={route} destination={place.coordinates} fullscreen />
      ) : (
        <View style={styles.centered}>
          {mode === 'route' && routeState.status === 'loading' ? (
            <ActivityIndicator />
          ) : (
            <>
              <Compass target={place.coordinates} />
              {mode === 'route' && routeState.status === 'none' && (
                <ThemedText type="small" themeColor="textSecondary">
                  No walking route available — compass it is.
                </ThemedText>
              )}
            </>
          )}
        </View>
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <View style={[styles.topCard, { backgroundColor: theme.background }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            hitSlop={Spacing.two}>
            <ThemedText type="headline" themeColor="textSecondary">
              ✕
            </ThemedText>
          </Pressable>
          <View style={styles.topText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {place.name}
            </ThemedText>
            {route && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatWalkTime(route.seconds)} · {formatDistance(route.meters)}
              </ThemedText>
            )}
          </View>
        </View>

        <View style={[styles.modeToggle, { backgroundColor: theme.background }]}>
          {(['route', 'compass'] as const).map((value) => (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === value }}
              onPress={() => setMode(value)}
              style={[styles.modeOption, mode === value && { backgroundColor: theme.accent }]}>
              <ThemedText
                type={mode === value ? 'smallBold' : 'small'}
                style={mode === value ? styles.modeSelected : undefined}
                themeColor={mode === value ? undefined : 'textSecondary'}>
                {value === 'route' ? 'Route' : 'Compass'}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </SafeAreaView>

      {mode === 'route' && guidance && (
        <SafeAreaView style={styles.sheetArea} edges={['bottom']} pointerEvents="box-none">
          <Pressable
            accessibilityRole="button"
            onPress={() => setStepsOpen((open) => !open)}
            style={[styles.sheet, { backgroundColor: theme.background }]}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetText}>
                <ThemedText type="headline">
                  {guidance.arrived ? 'You have arrived' : guidance.step.instruction}
                </ThemedText>
                {!guidance.arrived && (
                  <ThemedText type="small" themeColor="textSecondary">
                    {formatDistance(guidance.metersToManeuver)} to next turn
                  </ThemedText>
                )}
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {stepsOpen ? '▼' : '▲'}
              </ThemedText>
            </View>
            {stepsOpen &&
              route &&
              route.steps.map((step, index) => (
                <ThemedText
                  key={`${index}-${step.instruction}`}
                  type="small"
                  themeColor={index === guidance.stepIndex ? undefined : 'textSecondary'}>
                  {index + 1}. {step.instruction}
                  {step.meters > 0 ? ` · ${formatDistance(step.meters)}` : ''}
                </ThemedText>
              ))}
          </Pressable>
        </SafeAreaView>
      )}
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
    gap: Spacing.three,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  topCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
  topText: {
    flex: 1,
    gap: 1,
  },
  modeToggle: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginRight: Spacing.three,
    marginTop: Spacing.two,
    borderRadius: 999,
    padding: Spacing.half,
    gap: Spacing.half,
  },
  modeOption: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  modeSelected: {
    color: '#FFFFFF',
  },
  sheetArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  sheetText: {
    flex: 1,
    gap: 2,
  },
});
