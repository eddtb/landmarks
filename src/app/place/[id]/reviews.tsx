import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';

import { ReviewList } from '@/components/review-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { usePlaceDetails } from '@/hooks/use-place-details';

/** The full comments, one tap deeper than the venue screen's summary. */
export default function ReviewsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state } = usePlaceDetails(id);

  if (state.status !== 'ready') {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: 'Reviews' }} />
        {state.status === 'loading' ? (
          <ActivityIndicator />
        ) : (
          <ThemedText themeColor="textSecondary">Reviews could not be loaded.</ThemedText>
        )}
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Reviews' }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        <ReviewList
          reviews={state.details.reviews ?? []}
          summary={state.details.reviewSummary}
        />
        {state.details.mapsUri && (
          <ThemedText
            type="small"
            themeColor="accent"
            style={styles.allReviews}
            onPress={() => Linking.openURL(state.details.mapsUri!)}>
            All reviews on Google Maps ›
          </ThemedText>
        )}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
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
    padding: Spacing.four,
  },
  allReviews: {
    paddingTop: Spacing.three,
  },
});
