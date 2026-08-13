import { useState } from 'react';
import { FlatList, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIslandHeader, useIslandInset } from '@/components/glass-header';
import { HistoryCard } from '@/components/history-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import {
  disableKeepOffline,
  enableKeepOffline,
  useDownloadStatus,
} from '@/data/offline-download';
import { useKeepOffline } from '@/data/offline-pack';
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
  // The island reports its height; the shelf starts below it and
  // slides beneath it on scroll. A sane guess until first layout.
  const [islandHeight, setIslandHeight] = useState(44);
  // ONE origin, shared with Nearby and Quiz (#300): this screen used to
  // add insets.top itself while Nearby let a SafeAreaView supply it.
  const topInset = useIslandInset(islandHeight);

  if (saved === null) {
    return <ThemedView style={styles.screen} testID="saved-screen" />;
  }

  return (
    <ThemedView style={styles.screen} testID="saved-screen">
      <FlatList<SavedPlace>
        data={saved}
        keyExtractor={(place) => String(place.item.pageId)}
        contentContainerStyle={{
          paddingTop: topInset,
          paddingBottom: Spacing.four + insets.bottom,
        }}
        ListHeaderComponent={saved.length > 0 ? <KeepOfflineRow /> : null}
        renderItem={({ item: place }) => (
          <View style={styles.cardWrap}>
            <HistoryCard item={place.item} saved />
            <DownloadState pageId={place.item.pageId} />
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
      {/* After the list so it paints above; the shelf scrolls under it.
          The island offsets itself below the notch. */}
      <GlassIslandHeader onHeight={setIslandHeight}>
        <View style={styles.islandWords}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            Saved{saved.length > 0 ? ` · ${saved.length}` : ''}
          </ThemedText>
        </View>
      </GlassIslandHeader>
    </ThemedView>
  );
}

/**
 * The Spotify move: saving is free, downloading is one deliberate
 * switch. On, everything on the shelf fetches itself — story,
 * telling, hero — and future saves follow suit. Off is a purge:
 * downloads go, saves stay.
 */
function KeepOfflineRow() {
  const keepOffline = useKeepOffline();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleWords}>
        <ThemedText type="smallBold">Keep saved stories offline</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {keepOffline
            ? 'Stories download to this phone as you save them'
            : 'Download every saved story to this phone'}
        </ThemedText>
      </View>
      <Switch
        testID="keep-offline-switch"
        accessibilityLabel="Keep saved stories offline"
        value={keepOffline}
        onValueChange={(on) => (on ? enableKeepOffline() : disableKeepOffline())}
      />
    </View>
  );
}

/** The download's state, in words — glyphs don't say why a story is safe. */
function DownloadState({ pageId }: { pageId: number }) {
  const keepOffline = useKeepOffline();
  const status = useDownloadStatus(pageId);
  if (!keepOffline || status === undefined) {
    return null;
  }
  const words =
    status === 'done'
      ? 'Downloaded — works without signal'
      : status === 'downloading'
        ? 'Downloading…'
        : status === 'failed'
          ? 'Download failed — it will retry next time'
          : 'Waiting to download';
  return (
    <ThemedText type="caption" themeColor="textSecondary" style={styles.downloadState}>
      {words}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  toggleWords: {
    flex: 1,
    gap: 2,
  },
  downloadState: {
    paddingTop: Spacing.half,
  },
  islandWords: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three - 4,
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
