import * as Location from 'expo-location';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HistoryCard } from '@/components/history-card';
import { LocationPriming } from '@/components/location-priming';
import { PlaceCard } from '@/components/place-card';
import { Section, SectionPicker } from '@/components/section-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useFetchAnchor } from '@/hooks/use-fetch-anchor';
import { useHistory } from '@/hooks/use-history';
import { useLocation } from '@/hooks/use-location';
import { usePlaces } from '@/hooks/use-places';
import { useTheme } from '@/hooks/use-theme';
import { PlaceCategory } from '@/types/place';
import { Coordinates, distanceMeters, FallbackCoordinates } from '@/utils/geo';

export default function BrowseScreen() {
  const { status, coordinates, requestPermission } = useLocation();
  const [manualCenter, setManualCenter] = useState<Coordinates | null>(null);

  if (status === 'priming') {
    return (
      <ThemedView style={styles.container}>
        <LocationPriming onEnable={requestPermission} />
      </ThemedView>
    );
  }

  if (status === 'loading' || status === 'locating') {
    return (
      <ThemedView style={[styles.container, styles.centered]}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Finding places near you…
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <PlacesList
      center={coordinates ?? manualCenter ?? FallbackCoordinates}
      locationDenied={status === 'denied'}
      onManualCenter={setManualCenter}
    />
  );
}

function PlacesList({
  center,
  locationDenied,
  onManualCenter,
}: {
  center: Coordinates;
  locationDenied: boolean;
  onManualCenter: (center: Coordinates) => void;
}) {
  const [section, setSection] = useState<Section>('landmark');
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [searchText, setSearchText] = useState('');
  const theme = useTheme();

  const onSearchSubmit = useCallback(async () => {
    const query = searchText.trim();
    if (!query) {
      return;
    }
    try {
      // On-device geocoding — free, no Google billing
      const results = await Location.geocodeAsync(query);
      const first = results[0];
      if (first) {
        onManualCenter({ latitude: first.latitude, longitude: first.longitude });
      }
    } catch (error) {
      console.warn('Geocoding failed:', error);
    }
  }, [searchText, onManualCenter]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Nearby</ThemedText>
          {locationDenied && (
            <>
              <ThemedText
                type="small"
                themeColor="textSecondary"
                onPress={() => Linking.openSettings()}>
                Location is off — enable it in Settings, or search a place to explore:
              </ThemedText>
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                onSubmitEditing={onSearchSubmit}
                placeholder="Search near a place…"
                placeholderTextColor={theme.textSecondary}
                returnKeyType="search"
                style={[
                  styles.search,
                  { backgroundColor: theme.backgroundElement, color: theme.text },
                ]}
              />
            </>
          )}
          <SectionPicker selected={section} onSelect={setSection} />
          {section !== 'history' && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: openNowOnly }}
              onPress={() => setOpenNowOnly((value) => !value)}
              style={[
                styles.filterChip,
                { backgroundColor: openNowOnly ? theme.backgroundSelected : theme.backgroundElement },
              ]}>
              <ThemedText
                type={openNowOnly ? 'smallBold' : 'small'}
                themeColor={openNowOnly ? 'text' : 'textSecondary'}>
                Open now
              </ThemedText>
            </Pressable>
          )}
        </View>
        {/* key remounts the body per section: fresh scroll position, no
            cross-section state; the session caches make revisits instant */}
        {section === 'history' ? (
          <HistoryBody key="history" center={center} />
        ) : (
          <PlacesBody
            key={section}
            category={section}
            center={center}
            openNowOnly={openNowOnly}
          />
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

function PlacesBody({
  category,
  center,
  openNowOnly,
}: {
  category: PlaceCategory;
  center: Coordinates;
  openNowOnly: boolean;
}) {
  const [refreshing, setRefreshing] = useState(false);
  // Fetch from a stable anchor (moves after ~250m walked); distances and
  // ordering below track the live position on every GPS update.
  const anchor = useFetchAnchor(center);
  const { state, refresh } = usePlaces(category, anchor);

  const livePlaces = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    return state.places
      // "Open now" keeps unknowns: many landmarks report no hours at
      // all, and hiding them would empty the section, not filter it
      .filter((place) => !openNowOnly || place.openNow !== false)
      .map((place) => ({
        ...place,
        distanceMeters: distanceMeters(center, place.coordinates),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  }, [state, center, openNowOnly]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Couldn&apos;t load places right now.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={refresh}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={livePlaces}
      keyExtractor={(place) => place.id}
      renderItem={({ item }) => <PlaceCard place={item} />}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          Nothing here yet — try another section.
        </ThemedText>
      }
      ListFooterComponent={
        state.places.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            The {state.places.length} closest places
          </ThemedText>
        ) : null
      }
    />
  );
}

function HistoryBody({ center }: { center: Coordinates }) {
  const [refreshing, setRefreshing] = useState(false);
  const { state, refresh } = useHistory(center);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <ThemedText type="small" themeColor="textSecondary">
          Couldn&apos;t load history right now.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={refresh}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <FlatList
      data={state.items}
      keyExtractor={(item) => String(item.pageId)}
      renderItem={({ item }) => <HistoryCard item={item} />}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
          No recorded history right here — wander a little.
        </ThemedText>
      }
      ListFooterComponent={
        state.items.length > 0 ? (
          <ThemedText type="small" themeColor="textSecondary" style={styles.footer}>
            From Wikipedia, near your location
          </ThemedText>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    gap: Spacing.three,
  },
  list: {
    padding: Spacing.four,
    gap: Spacing.three,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.six,
  },
  footer: {
    textAlign: 'center',
    paddingVertical: Spacing.four,
  },
  search: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  filterChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.three,
  },
});
