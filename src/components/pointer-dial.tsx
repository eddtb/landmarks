import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHeading } from '@/hooks/use-heading';
import { bearingDegrees, Coordinates } from '@/utils/geo';

const DialSize = 200;
const AccentColor = '#3c87f7';

type Props = {
  user: Coordinates;
  /** Where the needle points — a destination (compass) or the next maneuver (route). */
  target: Coordinates;
  primary: string;
  secondary: string;
};

/**
 * The shared dial: a needle that points at `target` relative to the
 * direction the phone is facing, with text in the middle. Hides the
 * needle where no heading exists (e.g. the simulator).
 */
export function PointerDial({ user, target, primary, secondary }: Props) {
  const heading = useHeading(true);
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

  return (
    <View style={styles.container}>
      <View style={styles.dial}>
        {pointable && (
          <Animated.View
            style={[StyleSheet.absoluteFill, styles.needleLayer, needleStyle]}
            testID="compass-needle">
            <View style={styles.needle} />
          </Animated.View>
        )}
        <ThemedText type="subtitle">{primary}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {secondary}
        </ThemedText>
      </View>
      {!pointable && (
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
  dial: {
    width: DialSize,
    height: DialSize,
    borderRadius: DialSize / 2,
    borderWidth: 2,
    borderColor: AccentColor + '40',
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
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 30,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: AccentColor,
  },
});
