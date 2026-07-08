import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlaceCard } from '@/components/place-card';
import { SectionPicker } from '@/components/section-picker';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { placesByCategory } from '@/data/mock-places';
import { PlaceCategory } from '@/types/place';

export default function BrowseScreen() {
  const [category, setCategory] = useState<PlaceCategory>('landmark');
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Placeholder: re-querying around the current position arrives with real data.
    setTimeout(() => setRefreshing(false), 600);
  }, []);

  const places = placesByCategory(category);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <ThemedText type="subtitle">Nearby</ThemedText>
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
