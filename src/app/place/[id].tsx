import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Compass } from '@/components/compass';
import { ExternalLink } from '@/components/external-link';
import { PhotoGallery } from '@/components/photo-gallery';
import { ReviewList } from '@/components/review-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { usePlaceDetails } from '@/hooks/use-place-details';
import { useStory } from '@/hooks/use-story';
import { useTheme } from '@/hooks/use-theme';
import { CategoryLabels, Place } from '@/types/place';
import { formatRating } from '@/utils/format';

/** Google's weekdayHours is Monday-first; JS's getDay() is Sunday-first (0-6). */
function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

/** Platform-appropriate deep link, so "Directions" opens the user's own Maps app. */
function directionsUrl({ coordinates, name }: Place): string {
  const { latitude, longitude } = coordinates;
  const label = encodeURIComponent(name);

  return (
    Platform.select({
      ios: `maps:0,0?q=${label}@${latitude},${longitude}`,
      android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${label})`,
      default: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`,
    }) ?? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
  );
}

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  // Rich details when loaded; the list's cached summary until then
  const place = state.status === 'ready' ? state.details : summary;
  // The list search carries a walking-mode Maps link for this place
  const walkingUri =
    summary && 'walkingDirectionsUri' in summary
      ? (summary as { walkingDirectionsUri?: string }).walkingDirectionsUri
      : undefined;
  // phone/mapsUri only exist once details load — undefined while showing the summary
  const details = state.status === 'ready' ? state.details : undefined;
  const storyState = useStory(place);
  const theme = useTheme();
  const [hoursExpanded, setHoursExpanded] = useState(false);

  if (!place) {
    if (state.status === 'loading') {
      return (
        <ThemedView style={styles.notFound}>
          <Stack.Screen options={{ title: '' }} />
          <ActivityIndicator />
        </ThemedView>
      );
    }
    return (
      <ThemedView style={styles.notFound}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <ThemedText themeColor="textSecondary">This place could not be found.</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: place.name }} />
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}>
        {details?.photoUrls && details.photoUrls.length > 1 ? (
          <PhotoGallery photoUrls={details.photoUrls} />
        ) : (
          <Image source={{ uri: place.photoUrl }} style={styles.photo} contentFit="cover" />
        )}
        <View style={styles.body}>
          <ThemedText type="subtitle">{place.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {CategoryLabels[place.category]} · {formatRating(place.rating)}
            {place.ratingCount ? ` (${place.ratingCount.toLocaleString()} reviews)` : ''}
            {details?.priceLevel ? ` · ${details.priceLevel}` : ''}
          </ThemedText>

          <View style={styles.facts}>
            <ThemedText type="small">{place.address}</ThemedText>
            {place.hours && (
              <ThemedText type="small" themeColor="textSecondary">
                {place.hours}
              </ThemedText>
            )}
            {details?.weekdayHours && details.weekdayHours.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setHoursExpanded((expanded) => !expanded)}>
                {hoursExpanded ? (
                  details.weekdayHours.map((line) => (
                    <ThemedText key={line} type="small" themeColor="textSecondary">
                      {line}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {details.weekdayHours[todayIndex()]}
                  </ThemedText>
                )}
              </Pressable>
            )}
            {place.website && (
              <ExternalLink href={place.website}>
                <ThemedText type="linkPrimary">Visit website</ThemedText>
              </ExternalLink>
            )}
          </View>

          <Compass target={place.coordinates} />

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Linking.openURL(walkingUri ?? details?.mapsUri ?? directionsUrl(place))
              }
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold">Directions</ThemedText>
            </Pressable>
            {details?.phone && (
              <Pressable
                accessibilityRole="button"
                onPress={() => Linking.openURL(`tel:${details.phone}`)}
                style={({ pressed }) => [
                  styles.action,
                  { backgroundColor: theme.backgroundElement },
                  pressed && { opacity: 0.85 },
                ]}>
                <ThemedText type="smallBold">Call</ThemedText>
              </Pressable>
            )}
          </View>

          {storyState.status === 'ready' ? (
            <View style={styles.story}>
              <ThemedText type="smallBold">Story</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {storyState.story.story}
              </ThemedText>
              {!!storyState.story.url && (
                <ExternalLink href={storyState.story.url as `https://${string}`}>
                  <ThemedText type="linkPrimary">From Wikipedia</ThemedText>
                </ExternalLink>
              )}
            </View>
          ) : place.description ? (
            // Fallback chain: no Wikipedia article -> Google's editorial summary
            <View style={styles.story}>
              <ThemedText type="smallBold">About</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {place.description}
              </ThemedText>
            </View>
          ) : null}

          {details?.reviews && details.reviews.length > 0 && (
            <ReviewList reviews={details.reviews} />
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
  scrollView: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingBottom: Spacing.six,
  },
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  body: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  facts: {
    gap: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  action: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  story: {
    gap: Spacing.two,
  },
});
