import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CategoryLabels, Place, PlaceWithDistance } from '@/types/place';
import {
  closesSoonLabel,
  formatDistance,
  formatRating,
  formatWalkTime,
  openUntilLabel,
} from '@/utils/format';

type Props = {
  place: PlaceWithDistance;
};

/**
 * State as plain words, per the design contract: no colour coding,
 * ever. Closed places dim; the words carry the rest. Unknown hours
 * say nothing.
 */
export function placeStateLabel(place: Place): string | null {
  if (place.openNow === false) {
    return 'Closed';
  }
  if (place.openNow && place.nextCloseTime) {
    return (
      closesSoonLabel(place.nextCloseTime, new Date()) ?? openUntilLabel(place.nextCloseTime)
    );
  }
  if (place.openNow) {
    return 'Open';
  }
  return null;
}

/** "Pub · 4 min walk · ★ 4.7 · Open until 11pm" — one grey line. */
function metaLine(place: PlaceWithDistance): string {
  const parts = [
    place.primaryLabel ?? CategoryLabels[place.category],
    place.walkSeconds !== undefined
      ? formatWalkTime(place.walkSeconds)
      : formatDistance(place.distanceMeters),
    formatRating(place.rating),
  ];
  const state = placeStateLabel(place);
  if (state) {
    parts.push(state);
  }
  return parts.join(' · ');
}

export function PlaceCard({ place }: Props) {
  const theme = useTheme();
  const closed = place.openNow === false;

  return (
    // router.push, not Link asChild: asChild silently drops the
    // Pressable's function-style (verified by probe — cards rendered
    // with no background at all)
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/place/[id]', params: { id: place.id } })}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.backgroundElement },
        closed && styles.closedCard,
        pressed && { opacity: 0.85 },
      ]}>
        <Image
          source={{ uri: place.photoUrl }}
          style={styles.photo}
          contentFit="cover"
          transition={200}
        />
        <View style={styles.body}>
          <ThemedText type="headline" numberOfLines={1}>
            {place.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {metaLine(place)}
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
  closedCard: {
    opacity: 0.5,
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
