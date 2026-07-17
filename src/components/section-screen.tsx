import * as Location from 'expo-location';
import { router, useIsFocused } from 'expo-router';
import { ComponentType, ReactNode, useCallback, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryCard } from '@/components/history-card';
import { LocationPriming } from '@/components/location-priming';
import { PlaceCard } from '@/components/place-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useAreaName } from '@/hooks/use-area-name';
import { useFetchAnchor } from '@/hooks/use-fetch-anchor';
import { useHistory } from '@/hooks/use-history';
import { useLocation } from '@/hooks/use-location';
import { usePlaces } from '@/hooks/use-places';
import { useTheme } from '@/hooks/use-theme';
import { Place, PlaceCategory } from '@/types/place';
import { liveOpenNow } from '@/utils/format';
import { Coordinates, distanceMeters, FallbackCoordinates } from '@/utils/geo';
import {
  buildTypeGroups,
  matchesTypeFilter,
  TypeFilter,
  typeNoun,
} from '@/utils/place-types';

/**
 * The shared body of every tab: location gating, the NEARBY header
 * with the locator dot, and the section's list. Sections became tabs
 * (the pills were five top-level destinations dressed as a filter
 * row); each tab renders one of these.
 */

/** Location gating shared by all tabs. */
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
    <>
      {children({
        center: coordinates ?? manualCenter ?? FallbackCoordinates,
        locationDenied: status === 'denied',
        onManualCenter: setManualCenter,
      })}
    </>
  );
}

export type GateProps = {
  center: Coordinates;
  locationDenied: boolean;
  onManualCenter: (center: Coordinates) => void;
};

/** NEARBY over the area name with the locator dot; control sits opposite the title. */
function SectionHeader({
  center,
  locationDenied,
  onManualCenter,
  control,
}: GateProps & { control?: ReactNode }) {
  const [searchText, setSearchText] = useState('');
  const areaName = useAreaName(center);
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
    <View style={styles.header}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Nearby
      </ThemedText>
      <View style={styles.titleRow}>
        <View style={styles.titleGroup}>
          <View style={[styles.locatorDot, { backgroundColor: theme.accent }]} />
          <ThemedText type="largeTitle">{areaName ?? 'Near you'}</ThemedText>
        </View>
        {control}
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
            style={[
              styles.search,
              { backgroundColor: theme.backgroundElement, color: theme.text },
            ]}
          />
        </>
      )}
    </View>
  );
}

/** Nearest = shortest walk; Featured = Google's own prominence ranking. */
type SortMode = 'nearest' | 'featured';

const SortLabels: Record<SortMode, string> = { nearest: 'Nearest', featured: 'Featured' };

type MenuAction = {
  id: string;
  title: string;
  state?: 'on' | 'off';
  subactions?: MenuAction[];
};

type MenuViewProps = {
  actions: MenuAction[];
  onPressAction: (event: { nativeEvent: { event: string } }) => void;
  testID?: string;
  children?: ReactNode;
};

/**
 * @expo/ui resolves its native view at module scope, so this require
 * throws on clients built before the dependency existed — the catch
 * keeps older dev clients on the system-sheet fallback instead of
 * crashing every tab.
 */
const MenuView: ComponentType<MenuViewProps> | null = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@expo/ui/community/menu').MenuView;
  } catch {
    return null;
  }
})();

/** Fallback picker for clients whose build predates @expo/ui. */
function showSortSheet(onSelect: (mode: SortMode) => void) {
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Nearest', 'Featured', 'Cancel'], cancelButtonIndex: 2 },
      (index) => {
        if (index === 0) onSelect('nearest');
        if (index === 1) onSelect('featured');
      }
    );
    return;
  }
  Alert.alert('Sort places', undefined, [
    { text: 'Nearest', onPress: () => onSelect('nearest') },
    { text: 'Featured', onPress: () => onSelect('featured') },
    { text: 'Cancel', style: 'cancel' },
  ]);
}

/**
 * The count line's noun is the type filter: "31 places ▾" opens the
 * groups present in the loaded results (live counts, never a stale
 * option); picking one rewrites the sentence — "7 coffee shops ▾".
 * Groups folding several labels carry a submenu: the group itself,
 * then each specific label. Counts ride in the title because native
 * menu items have no trailing-text slot.
 */
function TypeMenu({
  places,
  typeFilter,
  onTypeChange,
}: {
  places: Place[];
  typeFilter: TypeFilter;
  onTypeChange: (filter: TypeFilter) => void;
}) {
  const count = places.filter((place) => matchesTypeFilter(place, typeFilter)).length;
  const label = (
    <ThemedText type="smallBold" themeColor="accent">
      {count} {typeNoun(typeFilter, count)} ▾
    </ThemedText>
  );
  const groups = buildTypeGroups(places);
  const actions: MenuAction[] = [
    { id: 'all', title: 'All types', state: typeFilter === 'all' ? 'on' : 'off' },
    ...groups.map((group): MenuAction => {
      const groupFilter: TypeFilter = `group:${group.group}`;
      const title = `${sentencePlural(group.group)} · ${group.count}`;
      if (group.labels.length <= 1) {
        return { id: groupFilter, title, state: typeFilter === groupFilter ? 'on' : 'off' };
      }
      return {
        id: `submenu:${group.group}`,
        title,
        subactions: [
          {
            id: groupFilter,
            title: `All ${typeNoun(groupFilter)}`,
            state: typeFilter === groupFilter ? 'on' : 'off',
          },
          ...group.labels.map((entry): MenuAction => {
            const labelFilter: TypeFilter = `label:${entry.label}`;
            return {
              id: labelFilter,
              title: `${entry.label} · ${entry.count}`,
              state: typeFilter === labelFilter ? 'on' : 'off',
            };
          }),
        ],
      };
    }),
  ];
  const onPress = (event: string) => {
    if (event === 'all' || event.startsWith('group:') || event.startsWith('label:')) {
      onTypeChange(event as TypeFilter);
    }
  };
  if (!MenuView) {
    return (
      <Pressable
        accessibilityRole="button"
        hitSlop={Spacing.two}
        onPress={() => showTypeSheet(groups, onTypeChange)}>
        {label}
      </Pressable>
    );
  }
  return (
    <MenuView
      testID="type-menu"
      actions={actions}
      onPressAction={({ nativeEvent }) => onPress(nativeEvent.event)}>
      <Pressable accessibilityRole="button" hitSlop={Spacing.two}>
        {label}
      </Pressable>
    </MenuView>
  );
}

/** "Pub" -> "Pubs" for menu titles (typeNoun stays lowercase for the sentence). */
function sentencePlural(group: string): string {
  const noun = typeNoun(`group:${group}`);
  return group.slice(0, 1) + noun.slice(1);
}

/** Fallback picker for clients whose build predates @expo/ui — groups only. */
function showTypeSheet(
  groups: ReturnType<typeof buildTypeGroups>,
  onSelect: (filter: TypeFilter) => void
) {
  const options = ['All types', ...groups.map((group) => `${sentencePlural(group.group)} (${group.count})`)];
  if (Platform.OS === 'ios') {
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...options, 'Cancel'], cancelButtonIndex: options.length },
      (index) => {
        if (index === 0) onSelect('all');
        else if (index > 0 && index <= groups.length) onSelect(`group:${groups[index - 1].group}`);
      }
    );
    return;
  }
  Alert.alert('Filter by type', undefined, [
    { text: 'All types', onPress: () => onSelect('all') },
    ...groups.map((group) => ({
      text: `${sentencePlural(group.group)} (${group.count})`,
      onPress: () => onSelect(`group:${group.group}` as TypeFilter),
    })),
    { text: 'Cancel', style: 'cancel' as const },
  ]);
}

/**
 * The count line's sort control — an anchored system menu (per the
 * approved mock) with a checkmark on the active sort. A sort has no
 * "off", so it's a picker, not a segmented control.
 */
function SortMenu({
  sortMode,
  onSortChange,
}: {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
}) {
  const label = (
    <ThemedText type="smallBold" themeColor="accent">
      {SortLabels[sortMode]} ▾
    </ThemedText>
  );
  if (!MenuView) {
    return (
      <Pressable
        accessibilityRole="button"
        hitSlop={Spacing.two}
        onPress={() => showSortSheet(onSortChange)}>
        {label}
      </Pressable>
    );
  }
  return (
    <MenuView
      testID="sort-menu"
      actions={[
        { id: 'nearest', title: 'Nearest', state: sortMode === 'nearest' ? 'on' : 'off' },
        { id: 'featured', title: 'Featured', state: sortMode === 'featured' ? 'on' : 'off' },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === 'nearest' || nativeEvent.event === 'featured') {
          onSortChange(nativeEvent.event);
        }
      }}>
      <Pressable accessibilityRole="button" hitSlop={Spacing.two}>
        {label}
      </Pressable>
    </MenuView>
  );
}

/** All | Open — both states visible, so "off" is never ambiguous. */
function OpenNowSegmented({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: theme.backgroundElement }]}>
      {([false, true] as const).map((openOnly) => {
        const selected = value === openOnly;
        return (
          <Pressable
            key={String(openOnly)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(openOnly)}
            style={[styles.segment, selected && { backgroundColor: theme.accent }]}>
            <ThemedText
              type={selected ? 'smallBold' : 'small'}
              style={selected ? styles.segmentSelected : undefined}
              themeColor={selected ? undefined : 'textSecondary'}>
              {openOnly ? 'Open' : 'All'}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function PlaceSectionScreen({ category }: { category: PlaceCategory }) {
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>('nearest');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  // Native tabs mount every screen at launch — without this gate one
  // app open fetched all four categories at once (8 billed queries)
  const focused = useIsFocused();
  const [armed, setArmed] = useState(false);
  // Adjust-during-render (the React-endorsed pattern): arm on first
  // focus and stay armed — no effect, no cascading render
  if (focused && !armed) {
    setArmed(true);
  }

  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <SectionHeader
              {...gate}
              control={<OpenNowSegmented value={openNowOnly} onChange={setOpenNowOnly} />}
            />
            {armed && (
            <PlacesBody
              category={category}
              center={gate.center}
              openNowOnly={openNowOnly}
              sortMode={sortMode}
              onSortChange={setSortMode}
              typeFilter={typeFilter}
              onTypeChange={setTypeFilter}
            />
            )}
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

/**
 * History's home since it left the tab bar: a lavender invitation
 * above the Landmarks list, pitching its actual content. Scrolls
 * with the list — occasional content doesn't earn fixed chrome.
 */
function StoriesBanner({ center }: { center: Coordinates }) {
  const theme = useTheme();
  const areaName = useAreaName(center);
  const { state } = useHistory(center);
  const count = state.status === 'ready' ? state.items.length : 0;
  if (state.status === 'ready' && count === 0) {
    return null;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/stories')}
      style={[styles.banner, { backgroundColor: theme.accentSoft }]}>
      <View style={styles.bannerText}>
        <ThemedText type="smallBold" themeColor="accent">
          The stories of {areaName ?? 'this place'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {count > 0
            ? `What happened right here — ${count} ${count === 1 ? 'story' : 'stories'} from Wikipedia`
            : 'What happened right here, from Wikipedia'}
        </ThemedText>
      </View>
      <ThemedText type="headline" themeColor="accent">
        ›
      </ThemedText>
    </Pressable>
  );
}

function PlacesBody({
  category,
  center,
  openNowOnly,
  sortMode,
  onSortChange,
  typeFilter,
  onTypeChange,
}: {
  category: PlaceCategory;
  center: Coordinates;
  openNowOnly: boolean;
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  typeFilter: TypeFilter;
  onTypeChange: (filter: TypeFilter) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  // Fetch from a stable anchor (moves after ~250m walked); distances and
  // ordering below track the live position on every GPS update.
  const anchor = useFetchAnchor(center);
  const { state, refresh } = usePlaces(category, anchor);

  // The open filter narrows what the type menu counts; the type menu
  // narrows what the list shows. Both read as one sentence.
  const openPlaces = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    return (
      state.places
        // "Open" keeps unknowns: many landmarks report no hours at all,
        // and hiding them would empty the section, not filter it
        .filter((place) => !openNowOnly || liveOpenNow(place) !== false)
        .map((place) => ({
          ...place,
          distanceMeters: distanceMeters(center, place.coordinates),
        }))
    );
  }, [state, center, openNowOnly]);

  const livePlaces = useMemo(() => {
    return (
      openPlaces
        .filter((place) => matchesTypeFilter(place, typeFilter))
        // Featured: Google's prominence order, unranked places last,
        // distance as the tiebreak — no refetch, the rank rode in with
        // the list. Nearest: live straight-line, tracking GPS.
        .sort((a, b) =>
          sortMode === 'featured'
            ? (a.prominenceRank ?? Infinity) - (b.prominenceRank ?? Infinity) ||
              a.distanceMeters - b.distanceMeters
            : a.distanceMeters - b.distanceMeters
        )
    );
  }, [openPlaces, typeFilter, sortMode]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  if (state.status === 'loading') {
    // Skeleton cards hold the layout instead of a lone spinner
    return (
      <View style={styles.list}>
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            style={[styles.skeletonCard, { backgroundColor: theme.backgroundElement }]}>
            <View style={[styles.skeletonPhoto, { backgroundColor: theme.backgroundSelected }]} />
            <View style={styles.skeletonBody}>
              <View style={[styles.skeletonLine, { backgroundColor: theme.backgroundSelected }]} />
              <View
                style={[
                  styles.skeletonLine,
                  styles.skeletonLineShort,
                  { backgroundColor: theme.backgroundSelected },
                ]}
              />
            </View>
          </View>
        ))}
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
    <>
      {/* Fixed with the header, not scrolled with the list: controls
          that change the list shouldn't travel with it. A row, not
          nested Text — the menu anchors are native views. */}
      <View style={styles.controlLine}>
        <TypeMenu places={openPlaces} typeFilter={typeFilter} onTypeChange={onTypeChange} />
        <ThemedText type="small" themeColor="textSecondary">
          {' '}·{' '}
        </ThemedText>
        <SortMenu sortMode={sortMode} onSortChange={onSortChange} />
      </View>
      <FlatList
        data={livePlaces}
        keyExtractor={(place) => place.id}
        renderItem={({ item }) => <PlaceCard place={item} />}
        // The list scrolls under the translucent tab bar; the inset keeps
        // the last card reachable above it
        contentContainerStyle={[styles.list, { paddingBottom: Spacing.four + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={category === 'landmark' ? <StoriesBanner center={center} /> : null}
        ListEmptyComponent={
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Nothing here yet — try another section.
          </ThemedText>
        }
      />
    </>
  );
}

export function HistoryBody({ center }: { center: Coordinates }) {
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
          Couldn&apos;t load history right now.
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={refresh}>
          <ThemedText type="linkPrimary">Try again</ThemedText>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      {state.items.length > 0 && (
        // Attribution rides each card; the count line matches the
        // venue tabs' grammar and stays fixed with the header
        <View style={styles.controlLine}>
          <ThemedText type="small" themeColor="textSecondary">
            {state.items.length} {state.items.length === 1 ? 'story' : 'stories'}
          </ThemedText>
        </View>
      )}
      <FlatList
        data={state.items}
        keyExtractor={(item) => String(item.pageId)}
        renderItem={({ item }) => <HistoryCard item={item} />}
        contentContainerStyle={[styles.list, { paddingBottom: Spacing.four + insets.bottom }]}
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
  segmented: {
    flexDirection: 'row',
    borderRadius: 999,
    padding: 2,
  },
  segment: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: 999,
  },
  segmentSelected: {
    // White holds on the accent in both modes
    color: '#FFFFFF',
  },
  // Spacing contract: the control line sits tight beneath the header
  // (fixed, not scrolled — controls that change the list don't travel
  // with it) and the first card tight beneath that
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    borderRadius: Spacing.three - 2,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  bannerText: {
    flex: 1,
    gap: 1,
  },
  search: {
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 14,
  },
  skeletonCard: {
    borderRadius: Spacing.three,
    overflow: 'hidden',
  },
  skeletonPhoto: {
    width: '100%',
    aspectRatio: 16 / 9,
  },
  skeletonBody: {
    padding: Spacing.three,
    gap: Spacing.two,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 7,
    width: '55%',
  },
  skeletonLineShort: {
    width: '75%',
    height: 10,
  },
});
