import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useJournalEntry } from '@/data/journal';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { formatDaySince, formatWalkTime, hookEchoesTitle, storyHook } from '@/utils/format';

type Props = {
  item: HistoryItem;
  /** Archive cards wear the lavender spine and the honest tag. */
  archive?: boolean;
  /** Shelf cards drop the walk time: distanceMeters was minted where
   * the feed fetched it, and on the saved shelf — possibly another
   * town, another week — it is a lie. */
  saved?: boolean;
};

export function HistoryCard({ item, archive, saved }: Props) {
  const theme = useTheme();
  // The quiet ledger (journal mock A): a story the reader has read or
  // stood at stops shouting — the card dims, the hook goes, and the
  // meta line says so in a grey word. State is words and dimming,
  // never colour (the constitution's rule).
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
        journaled && styles.journaled,
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
              : `${formatWalkTime(Math.round(item.distanceMeters / 1.33))} · ${item.source}`) +
              (journalWord ? ` · ${journalWord}` : '')}
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
  journaled: {
    opacity: 0.62,
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
