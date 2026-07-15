import { Image } from 'expo-image';
import { Link } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { TodayEvent } from '@/types/today';
import { formatDistance } from '@/utils/format';

type Props = {
  event: TodayEvent;
};

/**
 * One thing happening today. Grounded events (venue matched to a real
 * Google place) link into the venue's place screen — photos, route,
 * compass; ungrounded ones open their source page.
 */
export function TodayCard({ event }: Props) {
  const theme = useTheme();

  const body = (
    <>
      {event.photoUrl && (
        <Image source={{ uri: event.photoUrl }} style={styles.photo} contentFit="cover" />
      )}
      <View style={styles.body}>
        <ThemedText type="smallBold" numberOfLines={2}>
          {event.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {event.venue} · {event.time}
          {event.distanceMeters !== undefined
            ? ` · ${formatDistance(event.distanceMeters)}`
            : ''}
        </ThemedText>
        {event.detail && (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
            {event.detail}
          </ThemedText>
        )}
        <ThemedText
          type="linkPrimary"
          onPress={(pressEvent) => {
            pressEvent.stopPropagation();
            WebBrowser.openBrowserAsync(event.sourceUrl);
          }}>
          Source
        </ThemedText>
      </View>
    </>
  );

  const cardStyle = ({ pressed }: { pressed: boolean }) => [
    styles.card,
    { backgroundColor: theme.backgroundElement },
    pressed && { opacity: 0.85 },
  ];

  if (event.placeId) {
    return (
      <Link href={{ pathname: '/place/[id]', params: { id: event.placeId } }} asChild>
        <Pressable accessibilityRole="button" style={cardStyle}>
          {body}
        </Pressable>
      </Link>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => WebBrowser.openBrowserAsync(event.sourceUrl)}
      style={cardStyle}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
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
