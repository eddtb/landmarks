import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  onEnable: () => void;
};

/**
 * Shown before the system location dialog so the user hears the "why"
 * from us first (pre-permission priming).
 */
export function LocationPriming({ onEnable }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ThemedText style={styles.emoji}>📍</ThemedText>
      <ThemedText type="subtitle" style={styles.title}>
        Discover what&apos;s around you
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.body}>
        Landmarks shows you interesting places nearby — sights, restaurants and pubs. To do that,
        it needs to know where you are.
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={onEnable}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.backgroundSelected },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold">Enable location</ThemedText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.five,
    gap: Spacing.three,
  },
  emoji: {
    fontSize: 56,
    lineHeight: 64,
  },
  title: {
    textAlign: 'center',
  },
  body: {
    textAlign: 'center',
  },
  button: {
    marginTop: Spacing.three,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.four,
  },
});
