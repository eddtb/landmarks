import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Compass } from '@/components/compass';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCachedHistoryItem } from '@/data/history-client';

/** A glance-and-dismiss bearing to the story, alongside the fuller Go mode. */
export default function CompassScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));
  const insets = useSafeAreaInsets();

  return (
    <ThemedView style={styles.container} testID="compass-screen">
      <Stack.Screen options={{ headerShown: false }} />
      {/* Top inset respected like Go's — a modal can still peek under
          the dynamic island. Close is a word, and violet: it's a
          button, and interactive means accent (the no-third-case rule
          the old grey ✕ broke). */}
      <View style={[styles.header, { paddingTop: Spacing.four + insets.top }]}>
        <ThemedText type="headline" numberOfLines={1} style={styles.title}>
          {item?.title ?? ''}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => router.back()}
          hitSlop={Spacing.three}>
          <ThemedText type="smallBold" themeColor="accent">
            Close
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
