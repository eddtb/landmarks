import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
} from 'react-native';

import { NavigationSection } from '@/components/navigation-section';
import { ExternalLink } from '@/components/external-link';
import { PhotoGallery } from '@/components/photo-gallery';
import { ReviewList } from '@/components/review-list';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { CardShadow, MaxContentWidth, Spacing } from '@/constants/theme';
import { useBusyness } from '@/hooks/use-busyness';
import { usePlaceDetails } from '@/hooks/use-place-details';
import { useStory } from '@/hooks/use-story';
import { useTheme } from '@/hooks/use-theme';
import { useWhatsOn } from '@/hooks/use-whats-on';
import { describeBusyness } from '@/utils/busyness';
import { CategoryLabels, Place } from '@/types/place';
import { formatRating, formatWalkTime } from '@/utils/format';

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
  // Real walking time rides in from the list search, like the Maps link
  const walkSeconds =
    summary && 'walkSeconds' in summary
      ? (summary as { walkSeconds?: number }).walkSeconds
      : undefined;
  // phone/mapsUri only exist once details load — undefined while showing the summary
  const details = state.status === 'ready' ? state.details : undefined;
  const storyState = useStory(place);
  const whatsOn = useWhatsOn(place);
  const busyness = useBusyness(place);
  const theme = useTheme();
  const [hoursExpanded, setHoursExpanded] = useState(false);
  const [kitchenExpanded, setKitchenExpanded] = useState(false);

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
          <View>
            <ThemedText type="largeTitle">{place.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {place.primaryLabel ?? CategoryLabels[place.category]} · {formatRating(place.rating)}
              {place.ratingCount ? ` (${place.ratingCount.toLocaleString()})` : ''}
              {details?.priceLevel ? ` · ${details.priceLevel}` : ''}
              {walkSeconds !== undefined ? (
                <>
                  {' · '}
                  <ThemedText type="smallBold" themeColor="accent">
                    {formatWalkTime(walkSeconds)}
                  </ThemedText>
                </>
              ) : null}
            </ThemedText>
          </View>

          {/* Go-there first: the app's whole purpose, no longer mid-scroll */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Linking.openURL(walkingUri ?? details?.mapsUri ?? directionsUrl(place))
              }
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryActionText}>
                Directions
              </ThemedText>
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
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                Share.share({
                  message: `${place.name} — ${details?.mapsUri ?? place.website ?? directionsUrl(place)}`,
                })
              }
              style={({ pressed }) => [
                styles.action,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold">Share</ThemedText>
            </Pressable>
          </View>

          {/* At a glance: hours, forecast, and verified facts — one card,
              because they are all the same question: should I go? */}
          <View style={[styles.facts, styles.glance, { backgroundColor: theme.backgroundElement }]}>
            {place.hours && (
              <ThemedText
                type="smallBold"
                themeColor={place.hours === 'Open now' ? 'open' : 'closed'}>
                {place.hours}
              </ThemedText>
            )}
            {busyness.status === 'ready' && (
              <ThemedText
                type="small"
                themeColor={
                  /busy|packed/.test(describeBusyness(busyness.pattern, new Date()))
                    ? 'signal'
                    : 'textSecondary'
                }>
                {describeBusyness(busyness.pattern, new Date())}
                {busyness.pattern.note ? ` — ${busyness.pattern.note}` : ''} · AI estimate
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
            {details?.kitchenWeekdayHours && details.kitchenWeekdayHours.length > 0 && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setKitchenExpanded((expanded) => !expanded)}>
                <ThemedText type="small" themeColor="textSecondary">
                  Kitchen{details.kitchenOpenNow === undefined
                    ? ''
                    : details.kitchenOpenNow
                      ? ' · open now'
                      : ' · closed now'}
                </ThemedText>
                {kitchenExpanded ? (
                  details.kitchenWeekdayHours.map((line) => (
                    <ThemedText key={line} type="small" themeColor="textSecondary">
                      {line}
                    </ThemedText>
                  ))
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    {details.kitchenWeekdayHours[todayIndex()]}
                  </ThemedText>
                )}
              </Pressable>
            )}
            {details?.amenities && details.amenities.length > 0 && (
              <View style={styles.chips}>
                {details.amenities.map((amenity) => (
                  <View
                    key={amenity}
                    style={[styles.chip, { backgroundColor: theme.backgroundSelected }]}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {amenity}
                    </ThemedText>
                  </View>
                ))}
              </View>
            )}
            <ThemedText type="small" themeColor="textSecondary">
              {place.address}
            </ThemedText>
            {place.website && (
              <ExternalLink href={place.website}>
                <ThemedText type="linkPrimary">Visit website</ThemedText>
              </ExternalLink>
            )}
          </View>

          <NavigationSection target={place.coordinates} />

          {whatsOn.status === 'ready' && (
            <View style={styles.story}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                What&apos;s on
              </ThemedText>
              {whatsOn.events.map((event) => (
                <View key={`${event.title}-${event.schedule}`} style={styles.event}>
                  <ThemedText type="small">
                    {event.title} · {event.schedule}
                    {event.detail ? ` · ${event.detail}` : ''}
                  </ThemedText>
                  <ExternalLink href={event.sourceUrl as `https://${string}`}>
                    <ThemedText type="linkPrimary">Source</ThemedText>
                  </ExternalLink>
                </View>
              ))}
              <ThemedText type="small" themeColor="textSecondary">
                Researched by AI from venue listings — check the source before you go.
              </ThemedText>
            </View>
          )}

          {storyState.status === 'ready' ? (
            <View style={styles.story}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                Story
              </ThemedText>
              <ThemedText type="storySerif">{storyState.story.story}</ThemedText>
              {!!storyState.story.url && (
                <ExternalLink href={storyState.story.url as `https://${string}`}>
                  <ThemedText type="linkPrimary">From Wikipedia</ThemedText>
                </ExternalLink>
              )}
            </View>
          ) : place.description ? (
            // Fallback chain: no Wikipedia article -> Google's editorial summary
            <View style={styles.story}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                About
              </ThemedText>
              <ThemedText type="storySerif">{place.description}</ThemedText>
            </View>
          ) : null}

          {((details?.reviews && details.reviews.length > 0) || details?.reviewSummary) && (
            <ReviewList reviews={details?.reviews ?? []} summary={details?.reviewSummary} />
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
  glance: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
    ...CardShadow,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  primaryActionText: {
    // White holds on the accent in both light and dark mode
    color: '#FFFFFF',
  },
  action: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
  },
  story: {
    gap: Spacing.two,
  },
  event: {
    gap: Spacing.half,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    paddingTop: Spacing.one,
  },
  chip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.half,
    borderRadius: Spacing.two,
  },
});
