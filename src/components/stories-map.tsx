import { AppleMaps, GoogleMaps } from 'expo-maps';
import { router } from 'expo-router';
import { Platform, StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';
import { cameraForRoute } from '@/utils/route-camera';

/**
 * The ground around you as a native map: your own position, and a pin
 * for every story near enough to walk to. Tap a pin, read the story.
 *
 * This exists because of App Review. 4.2.2 was cited three times —
 * "content aggregated from the Internet with limited or no native
 * functionality" — and the honest diagnosis was that a reviewer at a
 * desk could not reach any of the native functionality: arrivals need
 * you to walk, the widget was unavailable on the iPad they reviewed on,
 * and the only map in the app sat two taps deep behind a story's "Go".
 * A map of where you are, on the first screen, is the app's most
 * obviously-native surface and now nobody has to go looking for it.
 *
 * It earns its place regardless: seeing that four of the stories are
 * behind you and one is across the park is the thing a list of
 * distances cannot tell you.
 */

/** Pins to place. The deep feed runs to ~150 stories out to 3km, and
 * framing all of them zooms out until the pins are a smudge — the
 * nearest dozen is the walk you are actually deciding about. */
const MaxPins = 12;

export function StoriesMap({ items, center }: { items: HistoryItem[]; center: Coordinates }) {
  const theme = useTheme();

  // Already distance-sorted by the feed; slice is the nearest dozen
  const pinned = items.slice(0, MaxPins);
  if (pinned.length === 0) {
    return null;
  }

  // Frame your position AND the pins, so the map opens on the walk
  // rather than on an arbitrary centre
  const camera = cameraForRoute([center, ...pinned.map((item) => item.coordinates)]);
  const markers = pinned.map((item) => ({
    id: String(item.pageId),
    coordinates: item.coordinates,
    title: item.title,
    tintColor: theme.accent,
  }));

  // The marker object comes back as the event payload, so the id it
  // was given IS the route parameter — no lookup table to drift.
  const openStory = (marker: { id?: string }) => {
    if (marker.id) {
      router.push({ pathname: '/history/[pageId]', params: { pageId: marker.id } });
    }
  };

  return (
    <View style={styles.frame} testID="stories-map">
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          style={styles.map}
          cameraPosition={camera ?? undefined}
          markers={markers}
          onMarkerClick={openStory}
          properties={{ isMyLocationEnabled: true, selectionEnabled: true }}
        />
      ) : (
        <GoogleMaps.View
          style={styles.map}
          cameraPosition={camera ?? undefined}
          markers={markers}
          onMarkerClick={openStory}
          properties={{ isMyLocationEnabled: true, selectionEnabled: true }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    // The same 220pt card the route map uses — one map shape in the app
    height: 220,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
});
