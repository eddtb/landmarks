import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { GlassChip } from '@/components/glass-header';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useJournalEntry } from '@/data/journal';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { formatDaySince, formatWalkTime, hookEchoesTitle, storyHook } from '@/utils/format';
import { Coordinates, distanceMeters } from '@/utils/geo';

type Props = {
  item: HistoryItem;
  /** Archive cards wear the lavender spine and the honest tag. */
  archive?: boolean;
  /** Shelf cards drop the walk time: distanceMeters was minted where
   * the feed fetched it, and on the saved shelf — possibly another
   * town, another week — it is a lie. */
  saved?: boolean;
  /** The reader's live position. The feed no longer refetches as they
   * move (#323), so `distanceMeters` — minted at the feed's origin —
   * ages as they walk: with `from`, the walk time recomputes from
   * where they actually are, every render. Absent (the saved shelf,
   * exploring a pinned place the reader is not at), the compose-time
   * figure stands. */
  from?: Coordinates;
};

export function HistoryCard({ item, archive, saved, from }: Props) {
  const theme = useTheme();
  // The quiet ledger: a story the reader has read or stood at stops
  // shouting — the hook goes, and a glass tick sits on the photo
  // (Edd's pick from the mocked treatments, 2026-08-06; the original
  // whole-card 0.62 dim made photos look washed-out and broken on his
  // phone). Cards without a photo keep the grey meta word instead.
  const entry = useJournalEntry(item.pageId);
  const journaled = Boolean(entry?.readAt || entry?.visitedAt);
  const journalWord = entry?.visitedAt
    ? `Visited ${formatDaySince(entry.visitedAt)}`
    : entry?.readAt
      ? 'Read'
      : null;

  return (
    // router.push, not Link asChild — asChild drops function-styles
    <Pressable
      accessibilityRole="button"
      testID="history-card"
      onPress={() =>
        router.push({ pathname: '/history/[pageId]', params: { pageId: String(item.pageId) } })
      }
      // No pressed effect — cards navigate; the transition is the feedback
      style={[
        styles.card,
        { backgroundColor: theme.backgroundElement },
        // Archive cards wear a lavender spine and an honest tag —
        // deliberate, not broken; a palace's painting may still show
        archive && [styles.archive, { borderLeftColor: theme.accentSoft }],
      ]}>
        {item.thumbnailUrl && (
          <Image
            source={{ uri: item.thumbnailUrl }}
            style={styles.photo}
            contentFit="cover"
            // Feed thumbnails re-render constantly while walking —
            // memory-disk keeps them off the network (the FeaturedRail/
            // gallery precedent, #200)
            cachePolicy="memory-disk"
          />
        )}
        {item.thumbnailUrl && journalWord && (
          // THE chip, not a copy of it. This mark predated GlassChip and
          // hand-rolled the same pill from its own grey, which made it
          // the one chip in the app that never got real glass on iOS 26.
          // It is a worded mark on a photograph, so it takes the photo
          // material at the label's lighter weight.
          <GlassChip over="photo" style={styles.glassTick} testID="read-tick">
            <ThemedText type="captionBold" style={styles.glassTickText}>
              ✓&ensp;{journalWord}
            </ThemedText>
          </GlassChip>
        )}
        <View style={styles.body}>
          {archive && (item.pastTag || item.source.startsWith('Open Plaques')) && (
            <ThemedText type="eyebrow" themeColor="accent">
              {item.source.startsWith('Open Plaques') ? 'Plaque' : item.pastTag}
            </ThemedText>
          )}
          <ThemedText type="headline" numberOfLines={2}>
            {item.title}
          </ThemedText>
          {/* The hook is the reason to tap — "a nuclear reactor ran
              here until 1996" — the title alone never says it. Unless
              it merely re-says the title (plaque inscriptions): a card
              repeating itself reads as broken */}
          {(() => {
            if (journaled) {
              return null; // the hook is the reason to tap; a read story needs none
            }
            const hook = storyHook(item.extract);
            return hook && !hookEchoesTitle(item.title, hook) ? (
              <ThemedText type="small" numberOfLines={3}>
                {hook}
              </ThemedText>
            ) : null;
          })()}
          <ThemedText type="small" themeColor="textSecondary">
            {/* Same walking estimate as demo mode: ~1.33 m/s */}
            {(saved
              ? item.source
              : `${formatWalkTime(
                  Math.round(
                    (from ? distanceMeters(from, item.coordinates) : item.distanceMeters) / 1.33
                  )
                )} · ${item.source}`) +
              // The tick on the photo says it; only photoless cards
              // still say it in the meta line
              (journalWord && !item.thumbnailUrl ? ` · ${journalWord}` : '')}
          </ThemedText>
        </View>
      </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three - 2,
    overflow: 'hidden',
  },
  archive: {
    borderLeftWidth: 3,
  },
  // Geometry only — the material is the chip's, from the Glass tokens
  glassTick: {
    position: 'absolute',
    top: Spacing.two + 2,
    right: Spacing.two + 2,
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.three - 4,
  },
  glassTickText: {
    color: '#FFFFFF',
  },
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
