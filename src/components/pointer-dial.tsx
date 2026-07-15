import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHeading } from '@/hooks/use-heading';
import { useTheme } from '@/hooks/use-theme';
import { bearingDegrees, Coordinates } from '@/utils/geo';

const DefaultDialSize = 200;

type Props = {
  user: Coordinates;
  /** Where the needle points — a destination (compass) or the next maneuver (route). */
  target: Coordinates;
  primary: string;
  secondary?: string;
  /** Dial diameter; needle scales with it. */
  size?: number;
  /** Sheet-sized variant: tiny primary text inside, nothing else. */
  compact?: boolean;
};

/**
 * The shared dial: a needle that points at `target` relative to the
 * direction the phone is facing, with text in the middle. Hides the
 * needle where no heading exists (e.g. the simulator).
 */
export function PointerDial({
  user,
  target,
  primary,
  secondary,
  size = DefaultDialSize,
  compact = false,
}: Props) {
  const heading = useHeading(true);
  const theme = useTheme();
  const rotation = useSharedValue(0);

  const pointable = heading !== null;
  const targetBearing = bearingDegrees(user, target);

  useEffect(() => {
    if (!pointable) {
      return;
    }
    const next = (targetBearing - (heading ?? 0) + 360) % 360;
    // Rotate via the shortest arc so 359° -> 1° doesn't spin the long way round
    const current = ((rotation.value % 360) + 360) % 360;
    let delta = next - current;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    rotation.value = withTiming(rotation.value + delta, { duration: 300 });
  }, [pointable, targetBearing, heading, rotation]);

  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const needleWidth = Math.round(size * 0.055);
  const needleHeight = Math.round(size * 0.15);

  return (
    <View style={compact ? styles.compactContainer : styles.container}>
      <View
        style={[
          styles.dial,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: theme.accent + '40',
          },
        ]}>
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
          <ThemedText style={styles.compactPrimary} themeColor="accent">
            {primary}
          </ThemedText>
        ) : (
          <>
            <ThemedText type="subtitle">{primary}</ThemedText>
            {secondary !== undefined && (
              <ThemedText type="small" themeColor="textSecondary">
                {secondary}
              </ThemedText>
            )}
          </>
        )}
      </View>
      {!pointable && !compact && (
        <ThemedText type="small" themeColor="textSecondary">
          Distance updates as you move
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
  compactPrimary: {
    fontSize: 10,
    lineHeight: 12,
    fontWeight: 800,
    marginTop: Spacing.two,
  },
});
