import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Compass } from '@/components/compass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCachedHistoryItem } from '@/data/history-client';

/** A glance-and-dismiss bearing to the story, alongside the fuller Go mode. */
export default function CompassScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));

  return (
    <ThemedView style={styles.container} testID="compass-screen">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <ThemedText type="headline" numberOfLines={1} style={styles.title}>
          {item?.title ?? ''}
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
        {item ? (
          <Compass target={item.coordinates} />
        ) : (
          <ThemedText themeColor="textSecondary">This story could not be found.</ThemedText>
        )}
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
