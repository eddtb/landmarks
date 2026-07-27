import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
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
import { getCachedHistoryItem } from '@/data/history-client';
import { fetchRoute } from '@/data/route-client';
import { useLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { WalkingRoute } from '@/types/route';
import { formatDistance, formatWalkTime } from '@/utils/format';
import { guidanceFor, needsReroute, RouteCorridor } from '@/utils/guidance';

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
 * Go mode: the whole screen is the journey — the venue-era UI, back
 * verbatim on Valhalla's free routes. The map fills it; the directions
 * sheet carries the compass dial beside the live step — one block, per
 * the design. No walking route degrades to the big compass alone.
 * Destination-agnostic: vanished palaces ride it too.
 */
export default function GoScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));
  const { status, coordinates } = useLocation();
  const [stepsOpen, setStepsOpen] = useState(false);
  const [routeState, setRouteState] = useState<
    { status: 'loading' } | { status: 'none' } | { status: 'ready'; route: WalkingRoute }
  >({ status: 'loading' });

  const latitude = coordinates?.latitude;
  const longitude = coordinates?.longitude;
  const target = item?.coordinates;

  // The route the user is currently walking, kept in a ref so GPS
  // ticks can be judged against it without re-running the effect
  const corridorRef = useRef<RouteCorridor | null>(null);

  useEffect(() => {
    if (latitude === undefined || longitude === undefined || !target) {
      return;
    }
    // A tick inside the current route's corridor is handled locally —
    // guidanceFor re-renders the live step; the router is only asked
    // again when the user has actually left the route (or the
    // destination changed). Issue #197: this used to fire ~every 27m.
    if (!needsReroute(corridorRef.current, { latitude, longitude }, target)) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const route = await fetchRoute({ latitude, longitude }, target);
        if (!cancelled) {
          corridorRef.current = { route, target };
          setRouteState({ status: 'ready', route });
        }
      } catch (error) {
        console.warn('Failed to load route:', error);
        if (!cancelled) {
          setRouteState((current) => (current.status === 'ready' ? current : { status: 'none' }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [latitude, longitude, target]);

  if (!item || !target) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ headerShown: false }} />
        <ThemedText themeColor="textSecondary">This story could not be found.</ThemedText>
      </ThemedView>
    );
  }

  const route = coordinates && routeState.status === 'ready' ? routeState.route : null;
  const guidance = route && coordinates ? guidanceFor(route, coordinates) : null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {route ? (
        <RouteMap route={route} destination={target} fullscreen />
      ) : (
        <View style={styles.centered}>
          {!coordinates ? (
            // No fix, no journey — but never a spinner that can't end:
            // denied says what would fix it and offers the door, and
            // the Close chrome below stays reachable throughout
            status === 'denied' ? (
              <>
                <ThemedText type="headline">Venture can’t see where you are</ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.deniedCopy}>
                  Walking there needs your position. The story reads fine without it.
                </ThemedText>
                <Pressable accessibilityRole="button" onPress={() => Linking.openSettings()}>
                  <ThemedText type="smallBold" themeColor="accent">
                    Enable location in Settings
                  </ThemedText>
                </Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator />
                <ThemedText type="small" themeColor="textSecondary">
                  Finding you…
                </ThemedText>
              </>
            )
          ) : routeState.status === 'loading' ? (
            <ActivityIndicator />
          ) : (
            <>
              <Compass target={target} />
              <ThemedText type="small" themeColor="textSecondary">
                No walking route available — compass it is.
              </ThemedText>
            </>
          )}
        </View>
      )}

      <SafeAreaView style={styles.overlay} edges={['top']} pointerEvents="box-none">
        <ChromeSurface style={styles.topCard} interactive>
          {/* Close is a word, and violet — the compass modal's exact
              treatment (the grey ✕ broke both halves of the rule);
              16pt slop on the 20px label clears the 44pt target */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => router.back()}
            hitSlop={Spacing.three}>
            <ThemedText type="smallBold" themeColor="accent">
              Close
            </ThemedText>
          </Pressable>
          <View style={styles.topText}>
            <ThemedText type="smallBold" numberOfLines={1}>
              {item.title}
            </ThemedText>
            {route && (
              <ThemedText type="small" themeColor="textSecondary">
                {formatWalkTime(route.seconds)} · {formatDistance(route.meters)}
              </ThemedText>
            )}
          </View>
        </ChromeSurface>
      </SafeAreaView>

      {guidance && coordinates && (
        <SafeAreaView style={styles.sheetArea} edges={['bottom']} pointerEvents="box-none">
          <ChromeSurface style={styles.sheet} interactive>
            <Pressable
              accessibilityRole="button"
              // The label carries what the sheet shows — the live step
              // — so the explicit label loses VoiceOver nothing; the
              // expanded state says which way the toggle will go
              accessibilityLabel={
                guidance.arrived
                  ? 'You have arrived. Steps'
                  : `${guidance.step.instruction}, ${formatDistance(guidance.metersToManeuver)} to next turn. Steps`
              }
              accessibilityState={{ expanded: stepsOpen }}
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
                {/* A word, not a triangle (PR #186) — and violet:
                    it names the tap the whole sheet header answers */}
                <ThemedText type="smallBold" themeColor="accent">
                  Steps
                </ThemedText>
              </View>
              {stepsOpen &&
                route &&
                route.maneuvers.map((maneuver, index) => (
                  <ThemedText
                    key={`${index}-${maneuver.instruction}`}
                    type="small"
                    themeColor={index === guidance.stepIndex ? undefined : 'textSecondary'}>
                    {index + 1}. {maneuver.instruction}
                    {maneuver.meters > 0 ? ` · ${formatDistance(maneuver.meters)}` : ''}
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
  deniedCopy: {
    textAlign: 'center',
    paddingHorizontal: Spacing.six,
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
