import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { CategoryLabels, PlaceWithDistance } from '@/types/place';
import {
  closesSoonLabel,
  formatDistance,
  formatRating,
  formatRatingCount,
  formatWalkTime,
} from '@/utils/format';

type Props = {
  place: PlaceWithDistance;
};

/** "Wine Bar · 6 min walk · ★ 4.6 (2.3k) · ££" — one scannable line. */
function metaLine(place: PlaceWithDistance): string {
  const parts = [
    place.primaryLabel ?? CategoryLabels[place.category],
    place.walkSeconds !== undefined
      ? formatWalkTime(place.walkSeconds)
      : formatDistance(place.distanceMeters),
    place.ratingCount
      ? `${formatRating(place.rating)} (${formatRatingCount(place.ratingCount)})`
      : formatRating(place.rating),
  ];
  if (place.priceLevel) {
    parts.push(place.priceLevel);
  }
  return parts.join(' · ');
}

export function PlaceCard({ place }: Props) {
  const theme = useTheme();
  // Only the negative is marked: "Open" on every card is noise, and a
  // dimmed card is information, not an error — a closed landmark is
  // still worth knowing about.
  const closed = place.openNow === false;
  const closingWarning =
    !closed && place.nextCloseTime ? closesSoonLabel(place.nextCloseTime, new Date()) : null;

  return (
    <Link href={{ pathname: '/place/[id]', params: { id: place.id } }} asChild>
      <Pressable
        accessibilityRole="button"
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
          <ThemedText type="smallBold" numberOfLines={1}>
            {place.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {metaLine(place)}
            {closed ? ' · Closed' : closingWarning ? ` · ${closingWarning}` : ''}
          </ThemedText>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  closedCard: {
    opacity: 0.55,
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
