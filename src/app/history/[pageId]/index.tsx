import * as Linking from 'expo-linking';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Share, StyleSheet, View } from 'react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { ExternalLink } from '@/components/external-link';
import { OverflowMenu } from '@/components/overflow-menu';
import { TellingSection } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchStory, getCachedHistoryItem, getStoriesAround } from '@/data/history-client';
import { markRead, markVisited } from '@/data/journal';
import { toggleSaved, useSaved, useSavedItem } from '@/data/saved';
import { useLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem, isWikiPageId } from '@/types/history';
import { formatWalkTimeForMeters, storyParagraphs } from '@/utils/format';
import { Coordinates, distanceMeters } from '@/utils/geo';

function mapsWalkingUrl(coordinates: Coordinates): string {
  const at = `${coordinates.latitude},${coordinates.longitude}`;
  return (
    Platform.select({
      ios: `maps:?daddr=${at}&dirflg=w`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=walking`,
    }) ?? `https://www.google.com/maps/dir/?api=1&destination=${at}&travelmode=walking`
  );
}

/** The journey controls ride under the hero: violet Go, Compass, Save. */
function ActionsLead({ item }: { item: HistoryItem }) {
  const theme = useTheme();
  // The walk time is live GPS or nothing: item.distanceMeters is the
  // moment the feed was fetched — a story saved in another town, or a
  // denied-location session measured from the fallback pin, would
  // quote a fabricated number on the primary button. The shelf card
  // already drops it for exactly this reason; the label says "Go"
  // alone when there is no honest fix.
  const { coordinates } = useLocation();
  const walkTime = coordinates
    ? formatWalkTimeForMeters(distanceMeters(coordinates, item.coordinates))
    : null;
  const saved = useSaved(item.pageId);

  return (
    <View style={styles.leadBlock}>
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
          {walkTime ? `Go · ${walkTime}` : 'Go'}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="compass-button"
        onPress={() =>
          router.push({
            pathname: '/history/[pageId]/compass',
            params: { pageId: String(item.pageId) },
          })
        }
        style={({ pressed }) => [
          styles.compass,
          { backgroundColor: theme.backgroundElement },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold">Compass</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        testID="save-button"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save this story'}
        onPress={() => toggleSaved(item)}
        style={({ pressed }) => [
          styles.compass,
          // Saved wears the door colours — accentSoft ground, accent
          // word — because violet means tappable and this stays a button
          { backgroundColor: saved ? theme.accentSoft : theme.backgroundElement },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold" themeColor={saved ? 'accent' : undefined}>
          {saved ? 'Saved' : 'Save'}
        </ThemedText>
      </Pressable>
      {/* One-line grey annotation: with the short denied-state "Go" label
          the meta gets more width and would wrap mid-word — truncate
          with a tail ellipsis instead (DESIGN.md: meta is a meta LINE) */}
      </View>
      {/* No source name here any more: with the byline ("Told by AI from
          {source}") and the one citation row both naming it, this meta
          line was the THIRD "Wikipedia" on a screen being defended
          against a guideline about collections of links. The name lives
          where attribution belongs. */}
    </View>
  );
}

/**
 * Headless: writes the journal's "visited" fact when the reader is
 * physically at the story — the same 45m the standing-on banner uses.
 * Its own component so GPS ticks re-render nothing but this null.
 */
function JournalVisitMarker({ item }: { item: HistoryItem }) {
  const { coordinates } = useLocation();
  const standing =
    coordinates !== null && distanceMeters(coordinates, item.coordinates) < 45;
  useEffect(() => {
    if (standing) {
      markVisited(item.pageId);
    }
  }, [standing, item.pageId]);
  return null;
}

/** No Wikipedia article of its own: the record stands, and cites itself. */
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
      {/* No StoryFolds. This used to render the source article in full
          beneath the record — the same republication the Gazetteer's
          fallback row did, and the exhibit App Review cited 4.2.2 for
          three times. The record above is short and the source is one
          citation away; a copy of the page adds nothing but the charge. */}
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
 * an article of their own show the record itself and a citation.
 */
export default function HistoryDetailScreen() {
  const { pageId } = useLocalSearchParams<{ pageId: string }>();
  const numericPageId = Number(pageId);

  // Cold start — a shared landmarks:// link opens here with an empty
  // session cache, so a miss fetches the single story before the
  // screen is allowed to say "not found".
  const [fetched, setFetched] = useState<HistoryItem | null>(null);
  const [missingPageId, setMissingPageId] = useState<number | null>(null);
  // Failure and absence are different verdicts: fetchStory resolves
  // null for a genuine 404 and THROWS on network trouble — a shared
  // link opened on flaky signal must offer a retry, not tell the
  // recipient the story doesn't exist.
  const [loadFailed, setLoadFailed] = useState(false);
  // The saved shelf is a peer source, not a cache: the item cache
  // evicts and expires, but a story the user chose to keep must open
  // from its snapshot forever (for synthetic heritage ids it is the
  // only copy anywhere). Reactive, so the screen recovers the moment
  // the shelf hydrates.
  const savedSnapshot = useSavedItem(numericPageId);
  const item =
    getCachedHistoryItem(numericPageId) ??
    savedSnapshot ??
    (fetched?.pageId === numericPageId ? fetched : undefined);

  useEffect(() => {
    if (item || missingPageId === numericPageId || loadFailed) {
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
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [item, missingPageId, numericPageId, loadFailed]);

  if (!item && loadFailed) {
    return (
      <ThemedView style={styles.notFound}>
        <Stack.Screen options={{ title: '' }} />
        <ThemedText themeColor="textSecondary">Couldn’t load this story right now.</ThemedText>
        <Pressable
          accessibilityRole="button"
          testID="story-retry"
          onPress={() => setLoadFailed(false)}>
          <ThemedText type="smallBold" themeColor="accent">
            Try again
          </ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

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

  // The web of history, bounded (#202): link candidates are the feed
  // bucket this story belongs to — its actual neighbourhood — never
  // the whole persisted item store (a title cached in another town
  // last week is not a door here, and 500 titles regex-scanning every
  // paragraph was the planner's bill). getStoriesAround answers with
  // a stable array, so this derivation memoizes instead of defeating
  // the compiler with a fresh identity per render.
  const others = getStoriesAround(item.pageId).filter((story) => story.pageId !== item.pageId);

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
        sourceUrl={item.url}
        // The telling can only open the place's OWN story: a plaque
        // screen tells its subject's article, and a telling written
        // from the inscription would speak past it. No extract, no
        // telling — the model must never write from nothing.
        tellingItem={!item.subject && item.extract?.trim() ? item : undefined}
        onReadThreshold={() => markRead(item.pageId)}
        lead={
          <>
            <JournalVisitMarker item={item} />
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
    gap: Spacing.three,
  },
  leadBlock: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  go: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.six,
  },
  goText: {
    color: '#FFFFFF',
  },
  compass: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.four,
    borderRadius: Spacing.six,
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
