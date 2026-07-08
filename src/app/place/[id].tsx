import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { placeById } from '@/data/mock-places';
import { CategoryLabels } from '@/types/place';
import { formatDistance, formatRating } from '@/utils/format';

export default function PlaceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const place = placeById(id);

  if (!place) {
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
        <Image source={{ uri: place.photoUrl }} style={styles.photo} contentFit="cover" />
        <View style={styles.body}>
          <ThemedText type="subtitle">{place.name}</ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {CategoryLabels[place.category]} · {formatDistance(place.distanceMeters)} ·{' '}
            {formatRating(place.rating)}
          </ThemedText>

          <View style={styles.facts}>
            <ThemedText type="small">{place.address}</ThemedText>
            {place.hours && (
              <ThemedText type="small" themeColor="textSecondary">
                {place.hours}
              </ThemedText>
            )}
            {place.website && (
              <ExternalLink href={place.website}>
                <ThemedText type="linkPrimary">Visit website</ThemedText>
              </ExternalLink>
            )}
          </View>

          {place.story && (
            <View style={styles.story}>
              <ThemedText type="smallBold">Story</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {place.story}
              </ThemedText>
            </View>
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
  story: {
    gap: Spacing.two,
  },
});
