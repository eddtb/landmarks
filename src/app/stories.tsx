import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HistoryBody, LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAreaName } from '@/hooks/use-area-name';
import { useTheme } from '@/hooks/use-theme';
import { Coordinates } from '@/utils/geo';

/**
 * The stories of where you are — History's home since it left the
 * tab bar: pushed from the Landmarks banner, reachable from anywhere
 * the header lives. The list itself is untouched.
 */
export default function StoriesScreen() {
  return (
    <LocationGate>
      {(gate) => (
        // Title and back label come from the root stack's screen options
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.container} edges={['left', 'right']}>
            <StoriesHeader center={gate.center} />
            <HistoryBody center={gate.center} />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

function StoriesHeader({ center }: { center: Coordinates }) {
  const areaName = useAreaName(center);
  const theme = useTheme();
  return (
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Stories
      </ThemedText>
      <View style={styles.titleGroup}>
        <View style={[styles.locatorDot, { backgroundColor: theme.accent }]} />
        <ThemedText type="largeTitle">{areaName ?? 'Near you'}</ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    marginTop: 2,
  },
  locatorDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
});
