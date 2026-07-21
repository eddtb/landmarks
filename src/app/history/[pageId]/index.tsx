import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { ExternalLink } from '@/components/external-link';
import { OverflowMenu } from '@/components/overflow-menu';
import { StoryFolds } from '@/components/story-folds';
import { TellingSection } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCachedHistoryItem, getCachedHistoryItems } from '@/data/history-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
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

/** The venue grammar rides under the hero: one violet Go. */
function ActionsLead({ item }: { item: HistoryItem }) {
  const theme = useTheme();
  const walkSeconds = estimatedWalkSeconds(item.distanceMeters);

  return (
    <View style={styles.lead}>
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
      <ThemedText type="small" themeColor="textSecondary" style={styles.leadMeta}>
        {item.source}
      </ThemedText>
    </View>
  );
}

/** No Wikipedia article of its own: the extract-and-folds story stands. */
function ExtractStory({ item }: { item: HistoryItem }) {
  if (!item.extract) {
    return null;
  }
  return (
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
  );
}

/**
 * A place now gets the same love as the area (Edd's call): the full
 * Gazetteer — hero, gallery, the story retold in parts, timeline,
 * the web of history — pointed at the place's OWN article, with the
 * venue grammar (one violet Go) riding under the hero. Places without
 * an article of their own keep the extract-and-folds story.
 */
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

  const others = getCachedHistoryItems().filter((story) => story.pageId !== item.pageId);

  return (
    <ThemedView style={styles.container} testID="story-screen">
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
      <AreaGazetteer
        areaName={item.title}
        relics={[]}
        allStories={others}
        refreshing={false}
        onRefresh={() => {}}
        lead={<ActionsLead item={item} />}
        empty={<ExtractStory item={item} />}
      />
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
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  go: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.six,
  },
  goText: {
    color: '#FFFFFF',
  },
  leadMeta: {
    flexShrink: 1,
  },
  section: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
