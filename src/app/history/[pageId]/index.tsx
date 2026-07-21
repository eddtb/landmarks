import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { OverflowMenu } from '@/components/overflow-menu';
import { StoryFolds } from '@/components/story-folds';
import { TellingSection } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { getCachedHistoryItem } from '@/data/history-client';
import { addToWalk, removeFromWalk, walkStopFromStory } from '@/data/plan-store';
import { usePlan } from '@/hooks/use-plan';
import { useTheme } from '@/hooks/use-theme';
import { formatWalkTime, storyParagraphs } from '@/utils/format';
import { Coordinates } from '@/utils/geo';

/** Same demo-mode walking estimate as everywhere else: ~1.33 m/s. */
function estimatedWalkSeconds(meters: number): number {
  return Math.round(meters / 1.33);
}

function mapsWalkingUrl(coordinates: Coordinates): string {
  const at = `${coordinates.latitude},${coordinates.longitude}`;
  return (
    Platform.select({
      ios: `maps:?daddr=${at}&dirflg=w`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=walking`,
    }) ?? `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=walking`
  );
}

/**
 * A history site is somewhere you can walk to, not something you read
 * about — so this is the venue grammar: large title, one violet Go,
 * the STORY section, honest attribution.
 */
export default function HistoryDetailScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const item = getCachedHistoryItem(Number(pageId));
  const theme = useTheme();
  const onWalk = usePlan().some((stop) => stop.pageId === Number(pageId));

  if (!item) {
    return (
      <ThemedView style={styles.notFound}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <ThemedText themeColor="textSecondary">This story could not be found.</ThemedText>
      </ThemedView>
    );
  }

  const walkSeconds = estimatedWalkSeconds(item.distanceMeters);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: item.title,
          headerRight: () => (
            <OverflowMenu
              actions={[
                { id: 'share', title: 'Share' },
                { id: 'maps', title: 'Open in Maps' },
              ]}
              onAction={(id) => {
                if (id === 'share') Share.share({ message: `${item.title} — ${item.url}` });
                if (id === 'maps') Linking.openURL(mapsWalkingUrl(item.coordinates));
              }}
            />
          ),
        }}
      />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        {item.thumbnailUrl && (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={styles.photo}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        )}
        {item.thumbnailCredit && (
          <ThemedText type="small" themeColor="textSecondary" style={styles.credit}>
            {item.thumbnailCredit}
          </ThemedText>
        )}
        <View style={styles.body}>
          <View>
            <ThemedText type="largeTitle">{item.title}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              History · {formatWalkTime(walkSeconds)} · {item.source}
            </ThemedText>
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/history/[pageId]/go',
                  params: { pageId: String(item.pageId) },
                })
              }
              style={({ pressed }) => [
                styles.go,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold" style={styles.goText}>
                Go · {formatWalkTime(walkSeconds)}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => (onWalk ? removeFromWalk(item.pageId) : addToWalk(walkStopFromStory(item)))}
              style={({ pressed }) => [
                styles.mini,
                { backgroundColor: theme.accentSoft },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                {onWalk ? '✓ On walk' : '＋ Walk'}
              </ThemedText>
            </Pressable>
          </View>

          {item.extract && (
            <View style={styles.section}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                Story
              </ThemedText>
              <TellingSection item={item} />
              {/* Reading type (16/24), real paragraphs — an extract is a
                  story body, not a meta line */}
              {storyParagraphs(item.extract).map((paragraph, index) => (
                <ThemedText key={index} type="default">
                  {paragraph}
                </ThemedText>
              ))}
              <StoryFolds item={item} />
              <ExternalLink href={item.url as `https://${string}`}>
                <ThemedText type="small" themeColor="accent">
                  From {item.source}
                </ThemedText>
              </ExternalLink>
            </View>
          )}
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
  credit: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.one,
    fontSize: 11,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.four,
  },
  meta: {
    marginTop: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  go: {
    flex: 2,
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  goText: {
    // White holds on the accent in both modes
    color: '#FFFFFF',
  },
  mini: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
});
