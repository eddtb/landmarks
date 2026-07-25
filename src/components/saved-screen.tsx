import { FlatList, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HistoryCard } from '@/components/history-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { SavedPlace, useSavedList } from '@/data/saved';
import { useTheme } from '@/hooks/use-theme';

/**
 * The Saved tab: the shelf the user fills themselves. Newest save
 * first (the store's own order). Empty is a state, not a failure —
 * the copy says how the shelf fills. While the first read is in
 * flight it shows nothing at all: a returning user's shelf must never
 * flash empty before it loads (the one-door rule).
 */
export function SavedScreen() {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const saved = useSavedList();

  if (saved === null) {
    return <ThemedView style={styles.screen} testID="saved-screen" />;
  }

  return (
    <ThemedView style={styles.screen} testID="saved-screen">
      <FlatList<SavedPlace>
        data={saved}
        keyExtractor={(place) => String(place.item.pageId)}
        contentContainerStyle={{
          paddingTop: insets.top + Spacing.three,
          paddingBottom: Spacing.four + insets.bottom,
        }}
        ListHeaderComponent={
          saved.length > 0 ? (
            <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.head}>
              Saved · {saved.length}
            </ThemedText>
          ) : null
        }
        renderItem={({ item: place }) => (
          <View style={styles.cardWrap}>
            <HistoryCard item={place.item} saved />
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
              Nothing saved yet — Save on any story keeps it here.
            </ThemedText>
          </View>
        }
        showsVerticalScrollIndicator={false}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  head: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.two,
  },
  cardWrap: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  empty: {
    alignItems: 'center',
    paddingTop: Spacing.six,
    gap: Spacing.three,
  },
  emptyCopy: {
    textAlign: 'center',
    maxWidth: 280,
  },
});
