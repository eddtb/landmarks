import { StyleSheet, View } from 'react-native';
import Animated, {
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHeadingValue } from '@/hooks/use-heading';
import { useTheme } from '@/hooks/use-theme';
import { bearingDegrees, Coordinates } from '@/utils/geo';

const DefaultDialSize = 200;
const TickCount = 60; // every 6°, majors on the cardinals

type Props = {
  user: Coordinates;
  /** Where the needle points — a destination (compass) or the next maneuver (route). */
  target: Coordinates;
  primary: string;
  secondary?: string;
  /** Dial diameter; needle scales with it. */
  size?: number;
  /** Sheet-sized variant: tiny primary text inside, nothing else —
   * Go's directions sheet. No ticks, no cardinals, no coach line. */
  compact?: boolean;
  /** Within arm's reach of the target: the needle rests at the top
   * and the coach line says so — a compass pointing at your feet
   * reads as broken. */
  arrived?: boolean;
  /** No position yet: the dial still stands (the void was the bug),
   * needle hidden, the words say what's happening. */
  locating?: boolean;
  /** Replaces the coach line — for no-fix states that are not
   * "waiting" (location denied: nothing here will ever arrive). */
  coach?: string;
};

/**
 * A rotation that always takes the shortest arc, so 359° -> 1°
 * doesn't spin the long way round. Both moving layers (needle,
 * cardinal card) turn through this. Entirely on the UI thread: the
 * heading SharedValue ticks at sensor rate while the user physically
 * turns, and reacting to it here costs zero React renders — the old
 * state-driven version re-rendered the whole dial per 2° step.
 */
/** Shared with the quiz's pointing question, which rotates a compass card
 *  the same way but deliberately shows no needle to the target. */
export function useShortestArc(
  heading: SharedValue<number>,
  angleFrom: (degrees: number) => number | null
) {
  const rotation = useSharedValue(0);
  useAnimatedReaction(
    () => angleFrom(heading.value),
    (next, previous) => {
      if (next === null || next === previous) {
        return;
      }
      const target = ((next % 360) + 360) % 360;
      const current = ((rotation.value % 360) + 360) % 360;
      let delta = target - current;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      rotation.value = withTiming(rotation.value + delta, { duration: 300 });
    }
  );
  return useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
}

/** The fixed tick ring: sixty accentSoft marks, longer on the cardinals. */
function TickRing({ size, color }: { size: number; color: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="dial-ticks">
      {Array.from({ length: TickCount }, (_, index) => {
        const major = index % (TickCount / 4) === 0;
        return (
          <View
            key={index}
            style={[styles.tickArm, { transform: [{ rotate: `${(index * 360) / TickCount}deg` }] }]}>
            <View
              style={{
                width: major ? 2.5 : 1.5,
                height: major ? Math.round(size * 0.055) : Math.round(size * 0.035),
                borderRadius: 1,
                backgroundColor: color,
              }}
            />
          </View>
        );
      })}
    </View>
  );
}

/**
 * The shared dial: a needle that points at `target` relative to the
 * direction the phone is facing, with text in the middle. The full
 * variant is an instrument — tick ring, a cardinal card that turns
 * with the earth (letters tilt like a real compass card), a coach
 * line in words beneath. Hides the needle where no heading exists
 * (e.g. the simulator).
 */
export function PointerDial({
  user,
  target,
  primary,
  secondary,
  size = DefaultDialSize,
  compact = false,
  arrived = false,
  locating = false,
  coach: coachOverride,
}: Props) {
  const { heading, available } = useHeadingValue(true);
  const theme = useTheme();

  const pointable = available && !locating;
  const targetBearing = bearingDegrees(user, target);

  // Arrived: the needle comes home to the top instead of chasing a
  // bearing computed between two nearly identical points
  const needleStyle = useShortestArc(heading, (degrees) => {
    'worklet';
    if (!pointable) {
      return null;
    }
    return arrived ? 0 : (targetBearing - degrees + 360) % 360;
  });
  // The cardinal card counter-rotates: N stays pinned to the world
  const cardStyle = useShortestArc(heading, (degrees) => {
    'worklet';
    return pointable ? (360 - degrees) % 360 : null;
  });

  const needleWidth = Math.round(size * 0.055);
  const needleHeight = Math.round(size * 0.15);

  const coach =
    coachOverride ??
    (locating
      ? 'Hold on — finding you'
      : arrived
        ? 'You’re here — look around'
        : pointable
          ? 'Turn until the needle sits at the top'
          : 'Distance updates as you move');

  return (
    <View style={compact ? styles.compactContainer : styles.container}>
      <View
        style={[
          styles.dial,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: theme.accentSoft,
          },
        ]}>
        {!compact && <TickRing size={size} color={theme.accentSoft} />}
        {!compact && pointable && (
          <Animated.View
            style={[StyleSheet.absoluteFill, cardStyle]}
            pointerEvents="none"
            testID="cardinal-card">
            <ThemedText type="eyebrow" style={[styles.cardinal, styles.cardinalN]}>
              N
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textSecondary" style={[styles.cardinal, styles.cardinalE]}>
              E
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textSecondary" style={[styles.cardinal, styles.cardinalS]}>
              S
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textSecondary" style={[styles.cardinal, styles.cardinalW]}>
              W
            </ThemedText>
          </Animated.View>
        )}
        {pointable && (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.needleLayer, needleStyle]}
            testID="compass-needle">
            <View
              style={[
                styles.needle,
                {
                  borderLeftWidth: needleWidth,
                  borderRightWidth: needleWidth,
                  borderBottomWidth: needleHeight,
                  borderBottomColor: theme.accent,
                },
              ]}
            />
          </Animated.View>
        )}
        {compact ? (
          // Raw 10px inside a fixed 56pt dial: capped so accessibility
          // sizes can't push the number out of the ring
          <ThemedText style={styles.compactPrimary} themeColor="accent" maxFontSizeMultiplier={1.4}>
            {primary}
          </ThemedText>
        ) : (
          <>
            <ThemedText style={[styles.primary, styles.dialNumber]} maxFontSizeMultiplier={1.4}>
              {primary}
            </ThemedText>
            {secondary !== undefined && (
              <ThemedText type="small" themeColor="textSecondary">
                {secondary}
              </ThemedText>
            )}
          </>
        )}
      </View>
      {!compact && (
        <ThemedText type="small" themeColor="textSecondary">
          {coach}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
  },
  compactContainer: {
    alignItems: 'center',
  },
  dial: {
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickArm: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingTop: 6,
  },
  cardinal: {
    position: 'absolute',
  },
  cardinalN: {
    top: Spacing.three - Spacing.half,
    alignSelf: 'center',
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  // Letters sit upright at rest and tilt with the card as it turns —
  // how a physical compass card behaves (and Apple's)
  cardinalS: {
    bottom: Spacing.three - Spacing.half,
    left: 0,
    right: 0,
    textAlign: 'center',
  },
  cardinalE: {
    right: Spacing.three - Spacing.half,
    top: '50%',
    marginTop: -7,
  },
  cardinalW: {
    left: Spacing.three - Spacing.half,
    top: '50%',
    marginTop: -7,
  },
  needleLayer: {
    alignItems: 'center',
  },
  needle: {
    marginTop: Spacing.two,
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  primary: {
    textAlign: 'center',
    paddingHorizontal: Spacing.four,
  },
  // Bespoke by geometry: the dial's fixed ring sizes its own number —
  // these two glyphs live outside the ramp, capped like all chrome
  dialNumber: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  compactPrimary: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 800,
    marginTop: Spacing.two,
  },
});
