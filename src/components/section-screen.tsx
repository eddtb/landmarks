import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { ReactNode, useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { router } from 'expo-router';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { HistoryCard } from '@/components/history-card';
import { LocationPriming } from '@/components/location-priming';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAreaName } from '@/hooks/use-area-name';
import { useHistory } from '@/hooks/use-history';
import { useLocation } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { featuredStories } from '@/utils/featured';
import { formatWalkTime } from '@/utils/format';
import { Coordinates, distanceMeters, FallbackCoordinates } from '@/utils/geo';

/** Pure and unit-tested: the story you are physically standing on. */
export function standingOn(
  items: HistoryItem[],
  center: Coordinates,
  maxMeters = 45
): HistoryItem | null {
  let best: HistoryItem | null = null;
  let bestDistance = maxMeters;
  for (const item of items) {
    // Live position vs compose-time distances: recompute, always
    const meters = distanceMeters(center, item.coordinates);
    if (meters <= bestDistance) {
      bestDistance = meters;
      best = item;
    }
  }
  return best;
}

/**
 * The Storyteller's home: location gating, the NEARBY header with the
 * locator dot, and the stories of where you stand.
 */

export function LocationGate({ children }: { children: (props: GateProps) => ReactNode }) {
  const { status, coordinates, requestPermission } = useLocation();
  const [manualCenter, setManualCenter] = useState<Coordinates | null>(null);

  if (status === 'priming') {
    return (
      <ThemedView style={styles.container}>
        <LocationPriming onEnable={requestPermission} />
      </ThemedView>
    );
  }

  if (status === 'locating') {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Finding places near you…
        </ThemedText>
      </ThemedView>
    );
  }

  const denied = status === 'denied';
  const center = manualCenter ?? coordinates ?? FallbackCoordinates;

  return children({
    center,
    locationDenied: denied && !manualCenter,
    onManualCenter: setManualCenter,
  });
}

export type GateProps = {
  center: Coordinates;
  locationDenied: boolean;
  onManualCenter: (center: Coordinates) => void;
};

/** The eyebrow over the area name with the locator dot. */
function SectionHeader({
  center,
  locationDenied,
  onManualCenter,
  eyebrow,
}: GateProps & { eyebrow: string }) {
  const [searchText, setSearchText] = useState('');
  const areaName = useAreaName(center);
  const theme = useTheme();

  const onSearchSubmit = useCallback(async () => {
    const query = searchText.trim();
    if (!query) {
      return;
    }
    try {
      // On-device geocoding — free
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
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        {eyebrow}
      </ThemedText>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <View style={[styles.locatorDot, { backgroundColor: theme.accent }]} />
          <ThemedText type="largeTitle">{areaName ?? 'Near you'}</ThemedText>
        </View>
      </View>
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
            style={[styles.search, { backgroundColor: theme.backgroundElement, color: theme.text }]}
          />
        </>
      )}
    </View>
  );
}

export function StoriesScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <SectionHeader {...gate} eyebrow="Nearby" />
            <HistoryBody center={gate.center} mode="nearby" />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

/**
 * The Gazetteer (Edd's pick): the place's own illustrated story with
 * the relics of its ground beneath. The denied-location header keeps
 * the manual search available; otherwise the hero IS the header.
 */
export function HistoryArchiveScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            {gate.locationDenied && <SectionHeader {...gate} eyebrow="History" />}
            <GazetteerBody center={gate.center} />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

function GazetteerBody({ center }: { center: Coordinates }) {
  const [refreshing, setRefreshing] = useState(false);
  const { state, refresh } = useHistory(center);
  const areaName = useAreaName(center);

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
          Couldn&apos;t load stories right now.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={refresh}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  const relics = state.items.filter((item) => !item.thumbnailUrl || item.pastTag);
  return (
    <AreaGazetteer
      areaName={areaName}
      relics={relics}
      allStories={state.items}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  );
}

/** The magic moment: a story within arm's reach leads the screen. */
export function StandingOnIt({ item, center }: { item: HistoryItem; center: Coordinates }) {
  const theme = useTheme();
  const meters = Math.round(distanceMeters(center, item.coordinates));
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() =>
        router.push({ pathname: '/history/[pageId]', params: { pageId: String(item.pageId) } })
      }
      style={({ pressed }) => [
        styles.standing,
        { backgroundColor: theme.accentSoft, borderColor: theme.accent },
        pressed && { opacity: 0.9 },
      ]}>
      <ThemedText type="eyebrow" themeColor="accent">
        You&apos;re standing on it
      </ThemedText>
      <ThemedText type="headline">{item.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {meters <= 15 ? 'right here' : `${meters} m from you`} · {item.source}
      </ThemedText>
    </Pressable>
  );
}

/** Mini featured listings up top (Edd's call): the fun-facts FORMAT,
 * but the content is places — the area's heavy hitters, tappable. */
export function FeaturedRail({
  items,
  excludePageId,
}: {
  items: HistoryItem[];
  excludePageId?: number;
}) {
  const theme = useTheme();
  const featured = featuredStories(items, excludePageId);

  if (featured.length < 2) {
    return null;
  }
  return (
    <View style={styles.featured}>
      <ThemedText type="eyebrow" themeColor="accent" style={styles.featuredEyebrow}>
        Featured
      </ThemedText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.featuredContent}>
        {featured.map((item) => (
          <Pressable
            key={item.pageId}
            accessibilityRole="button"
            accessibilityLabel={`Featured: ${item.title}`}
            onPress={() =>
              router.push({
                pathname: '/history/[pageId]',
                params: { pageId: String(item.pageId) },
              })
            }
            style={({ pressed }) => [
              styles.featuredCard,
              { backgroundColor: theme.accentSoft },
              pressed && { opacity: 0.85 },
            ]}>
            <Image
              source={{ uri: item.thumbnailUrl }}
              style={styles.featuredImage}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <ThemedText type="smallBold" style={styles.featuredTitle} numberOfLines={2}>
              {item.title}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary" style={styles.featuredMeta}>
              {formatWalkTime(Math.round(item.distanceMeters / 1.33))}
            </ThemedText>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

export function HistoryBody({ center }: { center: Coordinates; mode?: 'nearby' }) {
  const insets = useSafeAreaInsets();
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
          Couldn&apos;t load stories right now.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={refresh}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  // Nearby = things you can visit AND recognise: a subject photo and
  // no structured evidence of pastness. The past and the
  // unphotographed live in the Gazetteer next door.
  const items = state.items.filter((item) => item.thumbnailUrl && !item.pastTag);

  const standing = state.status === 'ready' ? standingOn(state.items, center) : null;

  return (
    <>
      {standing && <StandingOnIt item={standing} center={center} />}
      {/* The count stays pinned — Edd asked for the FEATURED items to
          scroll away, nothing else */}
      {items.length > 0 && (
        <View style={styles.controlLine}>
          <ThemedText type="small" themeColor="textSecondary">
            {items.length} {items.length === 1 ? 'story' : 'stories'} within a walk
          </ThemedText>
        </View>
      )}
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.pageId)}
        renderItem={({ item }) => <HistoryCard item={item} />}
        // Featured scrolls away with the listings (Edd's call) — it's
        // the list's header, not the screen's. The negative margin
        // cancels the list padding so the rail bleeds edge to edge.
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <FeaturedRail items={state.items} excludePageId={standing?.pageId} />
          </View>
        }
        // The deep feed can run to ~150 stories — render the first
        // screenful fast and let virtualisation handle the rest
        initialNumToRender={8}
        contentContainerStyle={[
          styles.list,
          // Room for the walk bar riding above the tab bar
          { paddingBottom: Spacing.four + insets.bottom },
        ]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            No recorded history right here — wander a little.
          </ThemedText>
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  header: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.three,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexShrink: 1,
  },
  locatorDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  listHeader: {
    // Cancel the list's horizontal padding: the rail manages its own
    // insets and must scroll edge to edge
    marginHorizontal: -Spacing.four,
    marginBottom: Spacing.one,
  },
  standing: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three - 2,
    borderWidth: 1.5,
    gap: 2,
  },
  featured: {
    marginTop: Spacing.two,
    gap: Spacing.one,
  },
  featuredEyebrow: {
    paddingHorizontal: Spacing.four,
  },
  featuredContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  featuredCard: {
    width: 148,
    borderRadius: Spacing.three - 2,
    padding: Spacing.one,
    gap: 2,
  },
  featuredImage: {
    width: '100%',
    height: 82,
    borderRadius: Spacing.three - 4,
  },
  featuredTitle: {
    fontSize: 13,
    lineHeight: 16,
    paddingHorizontal: 2,
  },
  featuredMeta: {
    fontSize: 11,
    paddingHorizontal: 2,
    paddingBottom: 2,
  },
  controlLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
    gap: Spacing.three,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.six,
  },
  search: {
    borderRadius: Spacing.three - Spacing.one,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    marginTop: Spacing.two,
    fontSize: 15,
  },
});
