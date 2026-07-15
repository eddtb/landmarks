import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { NavigationSection } from '@/components/navigation-section';
import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getCachedHistoryItem } from '@/data/history-client';
import { formatDistance } from '@/utils/format';

export default function HistoryDetailScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));

  if (!item) {
    return (
      <ThemedView style={styles.notFound}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <ThemedText themeColor="textSecondary">This story could not be found.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: item.title }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        {item.thumbnailUrl && (
          <Image source={{ uri: item.thumbnailUrl }} style={styles.photo} contentFit="cover" />
        )}
        <View style={styles.body}>
          <ThemedText type="subtitle">{item.title}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            History · {formatDistance(item.distanceMeters)} from you
          </ThemedText>
          <NavigationSection target={item.coordinates} />
          {item.extract && (
            <ThemedText type="small" themeColor="textSecondary">
              {item.extract}
            </ThemedText>
          )}
          <ExternalLink href={item.url as `https://${string}`}>
            <ThemedText type="linkPrimary">Read on Wikipedia</ThemedText>
          </ExternalLink>
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  scroll: {
    paddingBottom: Spacing.six,
  },
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
