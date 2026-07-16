import { router, Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Compass } from '@/components/compass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePlaceDetails } from '@/hooks/use-place-details';

/**
 * The compass as a glance-and-dismiss modal: point me at it, thanks,
 * swipe away. The full journey (map, steps) lives in Go mode.
 */
export default function CompassScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  const place = state.status === 'ready' ? state.details : summary;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <ThemedText type="headline" numberOfLines={1} style={styles.title}>
          {place?.name ?? ''}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          hitSlop={Spacing.two}>
          <ThemedText type="headline" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
      </View>
      <View style={styles.body}>
        {place ? <Compass target={place.coordinates} /> : <ActivityIndicator />}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  title: {
    flex: 1,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.six,
  },
});
