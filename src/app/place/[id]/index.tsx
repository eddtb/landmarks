import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { Link, router, Stack, useLocalSearchParams } from 'expo-router';
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
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { PhotoGallery } from '@/components/photo-gallery';
import { placeStateLabel } from '@/components/place-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useBusyness } from '@/hooks/use-busyness';
import { usePlaceDetails } from '@/hooks/use-place-details';
import { useStory } from '@/hooks/use-story';
import { useTheme } from '@/hooks/use-theme';
import { useWhatsOn } from '@/hooks/use-whats-on';
import { CategoryLabels } from '@/types/place';
import { describeBusyness } from '@/utils/busyness';
import { formatRating, formatWalkTime } from '@/utils/format';

/** Google's weekdayHours is Monday-first; JS's getDay() is Sunday-first (0-6). */
function todayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

export default function PlaceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { summary, state } = usePlaceDetails(id);
  const place = state.status === 'ready' ? state.details : summary;
  const details = state.status === 'ready' ? state.details : undefined;
  const walkSeconds =
    summary && 'walkSeconds' in summary
      ? (summary as { walkSeconds?: number }).walkSeconds
      : undefined;
  const storyState = useStory(place);
  const whatsOn = useWhatsOn(place);
  const busyness = useBusyness(place);
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

  // The card's state words, from the summary (details drop live-hours
  // fields); the details' plain open/closed string is the fallback.
  const stateLabel =
    (summary ? placeStateLabel(summary) : null) ?? detailsHoursLabel(details?.hours);
  const busynessLine =
    busyness.status === 'ready' ? describeBusyness(busyness.pattern, new Date()) : null;

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
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
          {/* Identity — reads exactly like a card */}
          <View>
            <ThemedText type="largeTitle">{place.name}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.meta}>
              {[
                place.primaryLabel ?? CategoryLabels[place.category],
                place.ratingCount
                  ? `${formatRating(place.rating)} (${place.ratingCount.toLocaleString()})`
                  : formatRating(place.rating),
                details?.priceLevel,
                stateLabel,
              ]
                .filter(Boolean)
                .join(' · ')}
            </ThemedText>
          </View>

          {/* One violet button: the journey is a mode, not a section.
              (router.push, not Link asChild — asChild dropped this
              Pressable's function-style entirely, leaving white-on-white) */}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({ pathname: '/place/[id]/go', params: { id: place.id } })
              }
              style={({ pressed }) => [
                styles.go,
                { backgroundColor: theme.accent },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold" style={styles.goText}>
                {walkSeconds !== undefined ? `Go · ${formatWalkTime(walkSeconds)}` : 'Go'}
              </ThemedText>
            </Pressable>
            {details?.phone && (
              <Pressable
                accessibilityRole="button"
                onPress={() => Linking.openURL(`tel:${details.phone}`)}
                style={({ pressed }) => [
                  styles.mini,
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
                  message: `${place.name} — ${details?.mapsUri ?? place.website ?? mapsSearchUrl(place.name, place.coordinates)}`,
                })
              }
              style={({ pressed }) => [
                styles.mini,
                { backgroundColor: theme.backgroundElement },
                pressed && { opacity: 0.85 },
              ]}>
              <ThemedText type="smallBold">Share</ThemedText>
            </Pressable>
          </View>

          {whatsOn.status === 'ready' && (
            <View style={styles.section}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                What&apos;s on
              </ThemedText>
              {whatsOn.events.map((event) => (
                <ThemedText key={`${event.title}-${event.schedule}`} type="small">
                  {event.title} · {event.schedule}
                  {event.detail ? ` · ${event.detail}` : ''}{' '}
                  <ExternalLink href={event.sourceUrl as `https://${string}`}>
                    <ThemedText type="small" themeColor="accent">
                      Source
                    </ThemedText>
                  </ExternalLink>
                </ThemedText>
              ))}
            </View>
          )}

          {storyState.status === 'ready' ? (
            <View style={styles.section}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                Story
              </ThemedText>
              <ThemedText type="storySerif">{storyState.story.story}</ThemedText>
              {!!storyState.story.url && (
                <ExternalLink href={storyState.story.url as `https://${string}`}>
                  <ThemedText type="small" themeColor="accent">
                    From Wikipedia
                  </ThemedText>
                </ExternalLink>
              )}
            </View>
          ) : place.description ? (
            // Fallback chain: no Wikipedia article -> Google's editorial summary
            <View style={styles.section}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                About
              </ThemedText>
              <ThemedText type="storySerif">{place.description}</ThemedText>
            </View>
          ) : null}

          {(details?.reviewSummary || (details?.reviews && details.reviews.length > 0)) && (
            <View style={styles.section}>
              <ThemedText type="eyebrow" themeColor="textSecondary">
                Reviews
              </ThemedText>
              {details.reviewSummary && (
                <ThemedText type="small">{details.reviewSummary}</ThemedText>
              )}
              <ThemedText type="small" themeColor="textSecondary">
                {details.reviewSummary ? 'Summarised with Gemini · ' : ''}
                <Link href={{ pathname: '/place/[id]/reviews', params: { id: place.id } }}>
                  <ThemedText type="small" themeColor="accent">
                    All reviews ›
                  </ThemedText>
                </Link>
              </ThemedText>
            </View>
          )}

          <View style={styles.section}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              Details
            </ThemedText>
            {(stateLabel || (details?.weekdayHours && details.weekdayHours.length > 0)) && (
              <View style={[styles.detailRow, { borderBottomColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Hours
                </ThemedText>
                <ThemedText type="small" style={styles.detailValue}>
                  {stateLabel ?? 'See hours'}
                  {details?.weekdayHours && details.weekdayHours.length > 0 ? (
                    <ThemedText
                      type="small"
                      themeColor="accent"
                      onPress={() => setHoursExpanded((expanded) => !expanded)}>
                      {'   '}
                      {hoursExpanded ? 'Hide' : 'All hours'}
                    </ThemedText>
                  ) : null}
                </ThemedText>
              </View>
            )}
            {hoursExpanded && details?.weekdayHours && (
              <View style={styles.hoursBlock}>
                {details.weekdayHours.map((line, index) => (
                  <ThemedText
                    key={line}
                    type="small"
                    themeColor={index === todayIndex() ? undefined : 'textSecondary'}>
                    {line}
                  </ThemedText>
                ))}
                {details.kitchenWeekdayHours && details.kitchenWeekdayHours.length > 0 && (
                  <ThemedText type="small" themeColor="textSecondary">
                    Kitchen today: {details.kitchenWeekdayHours[todayIndex()]}
                  </ThemedText>
                )}
              </View>
            )}
            {busynessLine && (
              <View style={[styles.detailRow, { borderBottomColor: theme.backgroundElement }]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Usually
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary" style={styles.detailValue}>
                  {busynessLine.replace(/^Usually /, '')} · estimate
                </ThemedText>
              </View>
            )}
            <View
              style={[
                styles.detailRow,
                !place.website && styles.lastRow,
                { borderBottomColor: theme.backgroundElement },
              ]}>
              <ThemedText type="small" themeColor="textSecondary">
                Address
              </ThemedText>
              <ThemedText type="small" style={styles.detailValue}>
                {place.address}
              </ThemedText>
            </View>
            {place.website && (
              <View style={[styles.detailRow, styles.lastRow]}>
                <ThemedText type="small" themeColor="textSecondary">
                  Website
                </ThemedText>
                <ExternalLink href={place.website}>
                  <ThemedText type="small" themeColor="accent">
                    {websiteLabel(place.website)}
                  </ThemedText>
                </ExternalLink>
              </View>
            )}
          </View>
        </View>
      </ScrollView>
      {/* Floating back button — the hero runs full-bleed to the top */}
      <SafeAreaView style={styles.backOverlay} edges={['top']} pointerEvents="box-none">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: theme.background }]}>
          <ThemedText type="headline">‹</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

function detailsHoursLabel(hours: string | undefined): string | null {
  if (hours === 'Open now') return 'Open now';
  if (hours === 'Closed now') return 'Closed';
  return null;
}

function websiteLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Visit website';
  }
}

function mapsSearchUrl(name: string, coordinates: { latitude: number; longitude: number }): string {
  const label = encodeURIComponent(name);
  return (
    Platform.select({
      ios: `maps:0,0?q=${label}@${coordinates.latitude},${coordinates.longitude}`,
      default: `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`,
    }) ?? `https://www.google.com/maps/search/?api=1&query=${coordinates.latitude},${coordinates.longitude}`
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
    gap: Spacing.four,
  },
  meta: {
    marginTop: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  go: {
    flex: 2,
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  goText: {
    // White holds on the accent in both modes
    color: '#FFFFFF',
  },
  mini: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  section: {
    gap: Spacing.two,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.two,
    borderBottomWidth: 1,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  detailValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  hoursBlock: {
    gap: Spacing.half,
    paddingLeft: Spacing.three,
  },
  backOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  backButton: {
    marginLeft: Spacing.three,
    marginTop: Spacing.two,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.94,
  },
});
