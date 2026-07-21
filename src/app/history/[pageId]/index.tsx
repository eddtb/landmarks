import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { ExternalLink } from '@/components/external-link';
import { OverflowMenu } from '@/components/overflow-menu';
import { StoryFolds } from '@/components/story-folds';
import { TellingSection } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchStory, getCachedHistoryItem, getCachedHistoryItems } from '@/data/history-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem, isWikiPageId } from '@/types/history';
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
  // A plaque's extract IS its inscription, and the lead's "The plaque
  // reads" block already shows it — saying it twice reads as broken
  const inscriptionShownAbove = item.source.startsWith('Open Plaques');
  return (
    <View style={styles.section}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Story
      </ThemedText>
      <TellingSection item={item} />
      {/* Reading type (16/24), real paragraphs — an extract is a
          story body, not a meta line */}
      {!inscriptionShownAbove &&
        storyParagraphs(item.extract).map((paragraph, index) => (
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
  const numericPageId = Number(pageId);

  // Cold start — a shared landmarks:// link opens here with an empty
  // session cache, so a miss fetches the single story before the
  // screen is allowed to say "not found".
  const [fetched, setFetched] = useState<HistoryItem | null>(null);
  const [missingPageId, setMissingPageId] = useState<number | null>(null);
  const item =
    getCachedHistoryItem(numericPageId) ??
    (fetched?.pageId === numericPageId ? fetched : undefined);

  useEffect(() => {
    if (item || missingPageId === numericPageId) {
      return;
    }
    let cancelled = false;
    fetchStory(numericPageId)
      .then((story) => {
        if (cancelled) return;
        if (story) setFetched(story);
        else setMissingPageId(numericPageId);
      })
      .catch(() => {
        // Upstream trouble reads the same as a missing story here —
        // there is nothing else this screen could honestly show
        if (!cancelled) setMissingPageId(numericPageId);
      });
    return () => {
      cancelled = true;
    };
  }, [item, missingPageId, numericPageId]);

  if (!item && missingPageId !== numericPageId) {
    return (
      <ThemedView style={styles.notFound} testID="story-loading">
        <Stack.Screen options={{ title: '' }} />
        <ActivityIndicator />
      </ThemedView>
    );
  }

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
                if (id === 'share') {
                  // Recipients with Venture jump straight to this story;
                  // the source URL on the second line keeps the share
                  // useful without the app. Synthetic heritage ids
                  // (plaques, register entries) can't deep-link — they
                  // keep the plain source URL.
                  const message = isWikiPageId(item.pageId)
                    ? `${item.title} — walk to it with Venture: landmarks://history/${item.pageId}\n${item.url}`
                    : `${item.title} — ${item.url}`;
                  Share.share({ message });
                }
                if (id === 'maps') Linking.openURL(mapsWalkingUrl(item.coordinates));
              }}
            />
          ),
        }}
      />
      <AreaGazetteer
        areaName={item.subject ?? item.title}
        relics={[]}
        allStories={others}
        refreshing={false}
        onRefresh={() => {}}
        lead={
          <>
            <ActionsLead item={item} />
            {/* A resolved plaque keeps its inscription in view — the
                primary source you are physically standing at */}
            {item.source.startsWith('Open Plaques') && item.extract && (
              <View style={styles.inscription}>
                <ThemedText type="eyebrow" themeColor="textSecondary">
                  The plaque reads
                </ThemedText>
                <ThemedText type="default">{item.extract}</ThemedText>
              </View>
            )}
          </>
        }
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
  inscription: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.one,
  },
  section: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
});
