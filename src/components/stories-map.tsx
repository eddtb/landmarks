import { AppleMaps, GoogleMaps } from 'expo-maps';
import { router } from 'expo-router';
import { useIsFocused } from 'expo-router/build/useIsFocused';
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';
import { cameraForPins } from '@/utils/route-camera';

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

/** The same 220pt card the route map uses — one map shape in the app. */
const MapHeight = 220;

export function StoriesMap({ items, center }: { items: HistoryItem[]; center: Coordinates }) {
  const theme = useTheme();
  // The camera has to fit the card, so it needs the card's real size.
  // The window width is the opening estimate; onLayout corrects it once,
  // before the tiles have finished drawing.
  const { width: windowWidth } = useWindowDimensions();
  const [frame, setFrame] = useState({ width: windowWidth, height: MapHeight });

  // Remount the native map when this screen regains focus. A tapped pin
  // stays SELECTED inside MapKit — drawn ~3x over its neighbours after
  // you come back from the story, and the oversize state even migrates
  // to the next tapped pin (simulator-verified). selectionEnabled:false
  // was tried first and does NOT clear it (the same run proved taps
  // still navigate, so it stays off for Apple's place cards) — there is
  // no deselect on the view ref, so a fresh mount is the lever we have.
  const focused = useIsFocused();
  const wasFocused = useRef(true);
  const [mapEpoch, setMapEpoch] = useState(0);
  useEffect(() => {
    if (focused && !wasFocused.current) {
      setMapEpoch((epoch) => epoch + 1);
    }
    wasFocused.current = focused;
  }, [focused]);

  // Already distance-sorted by the feed; slice is the nearest dozen
  const pinned = items.slice(0, MaxPins);
  if (pinned.length === 0) {
    return null;
  }

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setFrame((previous) =>
      Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1
        ? previous
        : { width, height }
    );
  };

  // Frame your position AND the pins, so the map opens on the walk
  // rather than on an arbitrary centre
  const camera = cameraForPins({
    points: [center, ...pinned.map((item) => item.coordinates)],
    widthPixels: frame.width,
    heightPixels: frame.height,
  });

  const markers = pinned.map((item) => ({
    id: String(item.pageId),
    coordinates: item.coordinates,
    title: item.title,
  }));

  // The marker object comes back as the event payload, so the id it
  // was given IS the route parameter — no lookup table to drift.
  const openStory = (marker: { id?: string }) => {
    if (marker.id) {
      router.push({ pathname: '/history/[pageId]', params: { pageId: marker.id } });
    }
  };

  // `selectionEnabled` is about selecting map FEATURES, not markers —
  // onMarkerClick fires regardless (simulator-verified both ways).
  // Nothing here wants Apple's place cards, so it stays off; the sticky
  // oversize SELECTED pin it was first hoped to cure is actually cleared
  // by the focus remount above.
  const properties = { isMyLocationEnabled: true, selectionEnabled: false };

  return (
    <View style={styles.frame} testID="stories-map" onLayout={onLayout}>
      {Platform.OS === 'ios' ? (
        <AppleMaps.View
          key={mapEpoch}
          style={styles.map}
          cameraPosition={camera ?? undefined}
          // A story wears the brand violet AND a building glyph: the
          // position dot is the same accent, and a bare violet pin was
          // distinguishable from "me" only by having a tail.
          markers={markers.map((marker) => ({
            ...marker,
            tintColor: theme.accent,
            systemImage: 'building.columns',
          }))}
          onMarkerClick={openStory}
          properties={properties}
        />
      ) : (
        <GoogleMaps.View
          style={styles.map}
          cameraPosition={camera ?? undefined}
          markers={markers}
          onMarkerClick={openStory}
          properties={properties}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    height: MapHeight,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
});
