import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import {
  addToWalk,
  clearWalk,
  moveWalkStop,
  removeFromWalk,
  WalkStop,
  walkStopFromStory,
} from '@/data/plan-store';
import { useHistory } from '@/hooks/use-history';
import { usePlan } from '@/hooks/use-plan';
import { useTheme } from '@/hooks/use-theme';
import { useWalkPlayer } from '@/hooks/use-walk-player';
import { formatWalkTime } from '@/utils/format';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * Walks: the anchor-first plan, re-aimed at stories. You supply the
 * stops (＋Walk on any story, or the doors below); the app supplies
 * order-keeping — real distances, your order, nothing invented. No
 * clocks, no dwell (Edd's rules). Persists until cleared. Doors are
 * client-side: nearby stories not yet on the walk — zero API calls.
 */

const WalkingPace = 1.33;

function legsFor(stops: WalkStop[], origin: Coordinates) {
  let position = origin;
  let totalSeconds = 0;
  const legs = stops.map((stop) => {
    const seconds = Math.round(distanceMeters(position, stop.coordinates) / WalkingPace);
    totalSeconds += seconds;
    position = stop.coordinates;
    return seconds;
  });
  return { legs, totalSeconds };
}

export function WalkScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <WalkBody center={gate.center} />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

function WalkBody({ center }: { center: Coordinates }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const stops = usePlan();
  const { playingIndex, play, stop: stopPlaying } = useWalkPlayer(stops);
  const { state } = useHistory(stops[stops.length - 1]?.coordinates ?? center);

  const doors =
    state.status === 'ready'
      ? state.items.filter((item) => !stops.some((stop) => stop.pageId === item.pageId)).slice(0, 3)
      : [];

  if (stops.length === 0) {
    return (
      <ScrollView
        contentContainerStyle={[styles.empty, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Walks
        </ThemedText>
        <ThemedText type="largeTitle" style={styles.emptyTitle}>
          No walk yet
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          Tap ＋ Walk on any story to start one — or begin with a stop near you. The walk stays
          here until you clear it.
        </ThemedText>
        {doors.map((item) => (
          <DoorCard key={item.pageId} stop={walkStopFromStory(item)} />
        ))}
      </ScrollView>
    );
  }

  const { legs, totalSeconds } = legsFor(stops, center);

  const onShare = () =>
    Share.share({ message: stops.map((stop, index) => `${index + 1}. ${stop.title}`).join('\n') });

  const onClear = () =>
    Alert.alert('Clear the walk?', undefined, [
      { text: 'Clear', style: 'destructive', onPress: clearWalk },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Walks
        </ThemedText>
        <View style={styles.titleRow}>
          <View style={styles.titleGroup}>
            <View style={[styles.dot, { backgroundColor: theme.accent }]} />
            <ThemedText type="largeTitle">Tonight</ThemedText>
          </View>
          <ThemedText type="small" themeColor="textSecondary" onPress={onClear}>
            Clear
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {stops.length} {stops.length === 1 ? 'stop' : 'stops'} ·{' '}
          {Math.round(totalSeconds / 60)} min walking
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => (playingIndex === null ? void play() : void stopPlaying())}
          style={({ pressed }) => [
            styles.play,
            { backgroundColor: theme.accent },
            pressed && { opacity: 0.85 },
          ]}>
          <ThemedText type="smallBold" style={styles.playText}>
            {playingIndex === null
              ? '▶ Play the walk'
              : `◼ Stop · playing ${playingIndex + 1} of ${stops.length}`}
          </ThemedText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        {stops.map((stop, index) => (
          <View key={stop.pageId}>
            <View style={styles.legRow}>
              <ThemedText type="small" themeColor="textSecondary">
                {formatWalkTime(legs[index])}{' '}
                <ThemedText
                  type="smallBold"
                  themeColor="accent"
                  onPress={() =>
                    router.push({
                      pathname: '/history/[pageId]/compass',
                      params: { pageId: String(stop.pageId) },
                    })
                  }>
                  Compass ›
                </ThemedText>
              </ThemedText>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: '/history/[pageId]',
                  params: { pageId: String(stop.pageId) },
                })
              }
              style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
              <View style={styles.cardHead}>
                <ThemedText type="headline" numberOfLines={1} style={styles.cardName}>
                  {stop.title}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${stop.title} up`}
                  disabled={index === 0}
                  hitSlop={Spacing.two}
                  onPress={() => moveWalkStop(index, -1)}>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={index === 0 && styles.arrowOff}>
                    ↑
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${stop.title} down`}
                  disabled={index === stops.length - 1}
                  hitSlop={Spacing.two}
                  onPress={() => moveWalkStop(index, 1)}>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    style={index === stops.length - 1 && styles.arrowOff}>
                    ↓
                  </ThemedText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${stop.title}`}
                  hitSlop={Spacing.two}
                  onPress={() => removeFromWalk(stop.pageId)}>
                  <ThemedText type="small" themeColor="textSecondary">
                    ✕
                  </ThemedText>
                </Pressable>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {stop.source}
              </ThemedText>
            </Pressable>
          </View>
        ))}

        <View style={styles.suggest}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            After this?
          </ThemedText>
          {doors.length > 0 ? (
            doors.map((item) => <DoorCard key={item.pageId} stop={walkStopFromStory(item)} />)
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing more to suggest right here.
            </ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onShare}
            style={({ pressed }) => [
              styles.share,
              { backgroundColor: theme.accentSoft },
              pressed && { opacity: 0.85 },
            ]}>
            <ThemedText type="smallBold" themeColor="accent">
              Share walk
            </ThemedText>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function DoorCard({ stop }: { stop: WalkStop }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => addToWalk(stop)}
      style={[styles.door, { backgroundColor: theme.backgroundElement }]}>
      {stop.thumbnailUrl && (
        <Image
          source={{ uri: stop.thumbnailUrl }}
          style={styles.doorPhoto}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}
      <View style={styles.doorBody}>
        <ThemedText type="smallBold">{stop.title}</ThemedText>
        {stop.hook && <ThemedText type="small">{stop.hook}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">
          {stop.source}
        </ThemedText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two, gap: Spacing.one },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleGroup: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 9, height: 9, borderRadius: 5 },
  play: {
    marginTop: Spacing.two,
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  playText: {
    // White holds on the accent in both modes
    color: '#FFFFFF',
  },
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  legRow: { paddingLeft: Spacing.two, paddingVertical: Spacing.one },
  card: { borderRadius: Spacing.three - 2, padding: Spacing.three, gap: Spacing.one },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cardName: { flex: 1 },
  arrowOff: { opacity: 0.3 },
  suggest: { paddingTop: Spacing.four, gap: Spacing.two },
  door: { borderRadius: Spacing.three - 2, overflow: 'hidden' },
  doorPhoto: { width: '100%', height: 72 },
  doorBody: { padding: Spacing.three, gap: 2 },
  share: {
    marginTop: Spacing.three,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
  empty: { paddingHorizontal: Spacing.five, paddingTop: Spacing.six, gap: Spacing.two },
  emptyTitle: { marginTop: Spacing.one },
  emptyBody: { marginBottom: Spacing.three },
});
