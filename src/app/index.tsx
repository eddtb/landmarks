import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LocationPriming } from '@/components/location-priming';
import { PlaceCard } from '@/components/place-card';
import { SectionPicker } from '@/components/section-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { placesByCategory } from '@/data/mock-places';
import { useLocation } from '@/hooks/use-location';
import { PlaceCategory } from '@/types/place';
import { FallbackCoordinates } from '@/utils/geo';

export default function BrowseScreen() {
  const [category, setCategory] = useState<PlaceCategory>('landmark');
  const [refreshing, setRefreshing] = useState(false);
  const { status, coordinates, requestPermission } = useLocation();

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Placeholder: re-querying around the current position arrives with real data.
    setTimeout(() => setRefreshing(false), 600);
  }, []);

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

  const denied = status === 'denied';
  const places = placesByCategory(category, coordinates ?? FallbackCoordinates);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Nearby</ThemedText>
          {denied && (
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
        <FlatList
          data={places}
          keyExtractor={(place) => place.id}
          renderItem={({ item }) => <PlaceCard place={item} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          showsVerticalScrollIndicator={false}
        />
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
});
