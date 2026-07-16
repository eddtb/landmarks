import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { formatDistance } from '@/utils/format';

type Props = {
  item: HistoryItem;
};

export function HistoryCard({ item }: Props) {
  const theme = useTheme();

  return (
    // router.push, not Link asChild — asChild drops function-styles
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/history/[pageId]', params: { pageId: String(item.pageId) } })
      }
      // No pressed effect — cards navigate; the transition is the feedback
      style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
        {item.thumbnailUrl && (
          <Image source={{ uri: item.thumbnailUrl }} style={styles.photo} contentFit="cover" />
        )}
        <View style={styles.body}>
          <ThemedText type="smallBold" numberOfLines={2}>
            {item.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            History · {formatDistance(item.distanceMeters)}
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
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
