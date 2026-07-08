import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LocationPriming } from '@/components/location-priming';
import { PlaceCard } from '@/components/place-card';
import { SectionPicker } from '@/components/section-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useLocation } from '@/hooks/use-location';
import { usePlaces } from '@/hooks/use-places';
import { PlaceCategory } from '@/types/place';
import { Coordinates, FallbackCoordinates } from '@/utils/geo';

export default function BrowseScreen() {
  const { status, coordinates, requestPermission } = useLocation();

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
      center={coordinates ?? FallbackCoordinates}
      locationDenied={status === 'denied'}
    />
  );
}

function PlacesList({ center, locationDenied }: { center: Coordinates; locationDenied: boolean }) {
  const [category, setCategory] = useState<PlaceCategory>('landmark');
  const [refreshing, setRefreshing] = useState(false);
  const { state, refresh } = usePlaces(category, center);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Nearby</ThemedText>
          {locationDenied && (
            <ThemedText
              type="small"
              themeColor="textSecondary"
              onPress={() => Linking.openSettings()}>
              Location is off — showing central London. Enable it in Settings to see places near
              you.
            </ThemedText>
          )}
          <SectionPicker selected={category} onSelect={setCategory} />
        </View>

        {state.status === 'loading' && (
          <View style={styles.centered}>
            <ActivityIndicator />
          </View>
        )}

        {state.status === 'error' && (
          <View style={styles.centered}>
            <ThemedText type="small" themeColor="textSecondary">
              Couldn&apos;t load places right now.
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={refresh}>
              <ThemedText type="linkPrimary">Try again</ThemedText>
            </Pressable>
          </View>
        )}

        {state.status === 'ready' && (
          <FlatList
            data={state.places}
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
        )}
      </SafeAreaView>
    </ThemedView>
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
});
