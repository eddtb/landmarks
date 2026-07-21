import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { formatWalkTime, historyTag, storyHook } from '@/utils/format';

type Props = {
  item: HistoryItem;
  /** Archive cards wear the lavender spine and the honest tag. */
  archive?: boolean;
};

export function HistoryCard({ item, archive }: Props) {
  const theme = useTheme();

  return (
    // router.push, not Link asChild — asChild drops function-styles
    <Pressable
      accessibilityRole="button"
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
          <Image source={{ uri: item.thumbnailUrl }} style={styles.photo} contentFit="cover" />
        )}
        <View style={styles.body}>
          {archive && (
            <ThemedText type="eyebrow" themeColor="accent">
              {item.source.startsWith('Open Plaques') ? 'Plaque' : historyTag(item.extract)}
            </ThemedText>
          )}
          <ThemedText type="headline" numberOfLines={2}>
            {item.title}
          </ThemedText>
          {/* The hook is the reason to tap — "a nuclear reactor ran
              here until 1996" — the title alone never says it */}
          {storyHook(item.extract) && (
            <ThemedText type="small" numberOfLines={3}>
              {storyHook(item.extract)}
            </ThemedText>
          )}
          <ThemedText type="small" themeColor="textSecondary">
            {/* Same walking estimate as demo mode: ~1.33 m/s; 🔊 marks a
                story with enough source text to earn a spoken telling */}
            {formatWalkTime(Math.round(item.distanceMeters / 1.33))} · {item.source}
            {item.extract ? ' · 🔊' : ''}
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
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
