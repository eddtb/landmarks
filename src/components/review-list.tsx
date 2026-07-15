import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PlaceReview } from '@/types/place';
import { formatRating } from '@/utils/format';

type Props = {
  reviews: PlaceReview[];
  /** Gemini-condensed review summary; attribution is required when shown. */
  summary?: string;
};

export function ReviewList({ reviews, summary }: Props) {
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <ThemedText type="smallBold">What people say</ThemedText>
      {summary && (
        <View style={styles.summary}>
          <ThemedText type="small">{summary}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Summarized with Gemini
          </ThemedText>
        </View>
      )}
      {reviews.map((review) => (
        <View
          key={`${review.author}-${review.when ?? ''}`}
          style={[styles.review, { backgroundColor: theme.backgroundElement }]}>
          <ThemedText type="small" numberOfLines={6}>
            {review.text}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {review.rating ? `${formatRating(review.rating)} · ` : ''}
            {review.author}
            {review.when ? ` · ${review.when}` : ''}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.two,
  },
  review: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.two,
  },
  // Deliberately not a card: the summary is the consensus, the cards are voices
  summary: {
    gap: Spacing.one,
    paddingBottom: Spacing.two,
  },
});
