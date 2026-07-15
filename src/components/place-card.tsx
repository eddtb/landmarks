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
  openUntilLabel,
} from '@/utils/format';

type Props = {
  place: PlaceWithDistance;
};

/** "Wine Bar · ★ 4.6 (2.3k) · ££" — walk time lives on the photo badge. */
function metaLine(place: PlaceWithDistance): string {
  const parts = [
    place.primaryLabel ?? CategoryLabels[place.category],
    place.ratingCount
      ? `${formatRating(place.rating)} (${formatRatingCount(place.ratingCount)})`
      : formatRating(place.rating),
  ];
  if (place.priceLevel) {
    parts.push(place.priceLevel);
  }
  return parts.join(' · ');
}

/**
 * The open/closed state as colour, not another dot-separated word:
 * green open, amber closes-soon, red closed (card also dims). Only
 * what's known is shown — no hours data, no state segment.
 */
function stateSegment(place: PlaceWithDistance): { text: string; color: 'open' | 'signal' | 'closed' } | null {
  if (place.openNow === false) {
    return { text: 'Closed', color: 'closed' };
  }
  if (place.openNow && place.nextCloseTime) {
    const warning = closesSoonLabel(place.nextCloseTime, new Date());
    if (warning) {
      return { text: warning, color: 'signal' };
    }
    const until = openUntilLabel(place.nextCloseTime);
    if (until) {
      return { text: until, color: 'open' };
    }
  }
  if (place.openNow) {
    return { text: 'Open', color: 'open' };
  }
  return null;
}

export function PlaceCard({ place }: Props) {
  const theme = useTheme();
  const closed = place.openNow === false;
  const state = stateSegment(place);
  const walkLabel =
    place.walkSeconds !== undefined
      ? formatWalkTime(place.walkSeconds)
      : formatDistance(place.distanceMeters);

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
        <View>
          <Image
            source={{ uri: place.photoUrl }}
            style={styles.photo}
            contentFit="cover"
            transition={200}
          />
          <View style={[styles.walkBadge, { backgroundColor: theme.background }]}>
            <ThemedText type="smallBold" themeColor={closed ? 'textSecondary' : 'accent'}>
              {walkLabel}
            </ThemedText>
          </View>
        </View>
        <View style={styles.body}>
          <ThemedText type="headline" numberOfLines={1}>
            {place.name}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {metaLine(place)}
            {state ? (
              <>
                {' · '}
                <ThemedText type="smallBold" themeColor={state.color}>
                  {state.text}
                </ThemedText>
              </>
            ) : null}
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
  walkBadge: {
    position: 'absolute',
    right: Spacing.two,
    bottom: Spacing.two,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
    opacity: 0.94,
  },
  body: {
    padding: Spacing.three,
    gap: Spacing.half,
  },
});
