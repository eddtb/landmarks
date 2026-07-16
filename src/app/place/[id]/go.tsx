import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  StyleSheet,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Compass } from '@/components/compass';
import { PointerDial } from '@/components/pointer-dial';
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

/**
 * Liquid glass chrome where supported (iOS 26+); the themed solid
 * surface — today's exact look — everywhere else. Content stays
 * opaque; only the chrome floating over the map is glass.
 */
function ChromeSurface({
  style,
  interactive,
  children,
}: {
  style: StyleProp<ViewStyle>;
  interactive?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView glassEffectStyle="regular" isInteractive={interactive} style={style}>
        {children}
      </GlassView>
    );
  }
  return <View style={[style, { backgroundColor: theme.background }]}>{children}</View>;
}

/**
 * Go mode: the whole screen is the journey. The map fills it; the
 * directions sheet carries the compass dial beside the live step —
 * one block, per the design. No walking route degrades to the big
 * compass alone.
 */
export default function GoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  const place = state.status === 'ready' ? state.details : summary;
  const { coordinates } = useLocation();
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

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {route ? (
        <RouteMap route={route} destination={place.coordinates} fullscreen />
      ) : (
        <View style={styles.centered}>
          {routeState.status === 'loading' ? (
            <ActivityIndicator />
          ) : (
            <>
              <Compass target={place.coordinates} />
              <ThemedText type="small" themeColor="textSecondary">
                No walking route available — compass it is.
              </ThemedText>
            </>
          )}
        </View>
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <ChromeSurface style={styles.topCard} interactive>
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
        </ChromeSurface>
      </SafeAreaView>

      {guidance && (
        <SafeAreaView style={styles.sheetArea} edges={['bottom']} pointerEvents="box-none">
          <ChromeSurface style={styles.sheet} interactive>
          <Pressable
            accessibilityRole="button"
            onPress={() => setStepsOpen((open) => !open)}
            style={styles.sheetPress}>
            <View style={styles.sheetHeader}>
              <PointerDial
                compact
                size={56}
                user={coordinates}
                target={guidance.target}
                primary={guidance.arrived ? 'Here' : formatDistance(guidance.metersToManeuver)}
              />
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
          </ChromeSurface>
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
  sheetArea: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  sheet: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.three,
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  sheetPress: {
    padding: Spacing.three,
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
