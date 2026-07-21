import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { usePlan } from '@/hooks/use-plan';
import { useTheme } from '@/hooks/use-theme';
import { useWalkPlayer } from '@/hooks/use-walk-player';
import { formatWalkTime } from '@/utils/format';
import { distanceMeters } from '@/utils/geo';
import { speechAvailable } from '@/utils/speech';

const WalkingPace = 1.33;

/**
 * The walk as a state, not a place (mock direction B): a violet
 * now-playing bar that exists only while a walk does. ▶ plays the
 * audio tour from anywhere — and only appears on clients whose
 * speech engine actually exists; tap the bar for the full builder.
 */
export function WalkBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const stops = usePlan();
  const { playingIndex, play, stop } = useWalkPlayer(stops);

  if (stops.length === 0) {
    return null;
  }

  let totalSeconds = 0;
  for (let index = 1; index < stops.length; index++) {
    totalSeconds += distanceMeters(stops[index - 1].coordinates, stops[index].coordinates) / WalkingPace;
  }

  return (
    <View style={[styles.area, { bottom: insets.bottom + Spacing.two }]} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the walk"
        onPress={() => router.push('/walk')}
        style={({ pressed }) => [
          styles.bar,
          { backgroundColor: theme.accent },
          pressed && { opacity: 0.9 },
        ]}>
        <View style={styles.text}>
          <ThemedText type="smallBold" style={styles.light} numberOfLines={1}>
            Tonight · {stops.length} {stops.length === 1 ? 'stop' : 'stops'}
          </ThemedText>
          <ThemedText type="small" style={styles.lightDim} numberOfLines={1}>
            {playingIndex !== null
              ? `playing ${playingIndex + 1} of ${stops.length} · ${stops[playingIndex]?.title}`
              : `${formatWalkTime(Math.round(totalSeconds))} between stops · next: ${stops[0].title}`}
          </ThemedText>
        </View>
        {speechAvailable && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={playingIndex === null ? 'Play the walk' : 'Stop playing'}
            hitSlop={Spacing.two}
            onPress={() => (playingIndex === null ? void play() : void stop())}
            style={[styles.play, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold" themeColor="accent">
              {playingIndex === null ? '▶' : '◼'}
            </ThemedText>
          </Pressable>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginHorizontal: Spacing.three,
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three + Spacing.half,
    borderRadius: Spacing.three,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  light: {
    color: '#FFFFFF',
  },
  lightDim: {
    color: '#FFFFFF',
    opacity: 0.85,
  },
  play: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
