import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchPlan } from '@/data/plan-client';
import { addToPlan, clearPlan, movePlanItem, PlanItem, removeFromPlan } from '@/data/plan-store';
import { usePlan } from '@/hooks/use-plan';
import { useTheme } from '@/hooks/use-theme';
import { Plan, PlanStop } from '@/types/plan';
import { clockLabel, formatWalkTime } from '@/utils/format';
import { Coordinates, distanceMeters } from '@/utils/geo';

/**
 * The Plan tab, anchor-first: YOU supply the stops (＋Plan anywhere,
 * or the suggestion rail's doors); the app supplies order-keeping —
 * computed times, walking legs, and "what fits after this". Persists
 * until cleared. Generation survives only as the empty state's
 * "Suggest a first stop".
 */

const WalkingPace = 1.33;

type Door = {
  placeId: string;
  name: string;
  photoUrl: string;
  primaryLabel?: string;
  rating?: number;
  why?: string;
  facts: string[];
  coordinates: Coordinates;
};

function doorsFromPlan(plan: Plan, excludeIds: Set<string>): Door[] {
  const stop: PlanStop | undefined = plan.stops[0];
  if (!stop) {
    return [];
  }
  return [stop, ...stop.alternates]
    .map((entry) => ({
      placeId: entry.placeId,
      name: entry.name,
      photoUrl: entry.photoUrl,
      primaryLabel: entry.primaryLabel,
      rating: entry.rating,
      why: entry.why,
      facts: entry.facts,
      coordinates: entry.coordinates,
    }))
    .filter((door) => !excludeIds.has(door.placeId))
    .slice(0, 3);
}

function doorToItem(door: Door): PlanItem {
  return {
    id: door.placeId,
    kind: 'place',
    name: door.name,
    photoUrl: door.photoUrl,
    primaryLabel: door.primaryLabel,
    coordinates: door.coordinates,
    rating: door.rating,
    facts: door.facts,
    dwellMinutes: /Restaurant/.test(door.primaryLabel ?? '') ? 90 : 60,
  };
}

/** Times are derived, never stored: now → leg → dwell → leg → … */
function computeTimeline(items: PlanItem[], origin: Coordinates) {
  let clock = Date.now();
  let position = origin;
  let totalWalkSeconds = 0;
  const rows = items.map((item) => {
    const legSeconds = Math.round(distanceMeters(position, item.coordinates) / WalkingPace);
    totalWalkSeconds += legSeconds;
    const arrive = new Date(clock + legSeconds * 1000);
    clock = arrive.getTime() + item.dwellMinutes * 60000;
    position = item.coordinates;
    return { item, legSeconds, arrive };
  });
  return { rows, totalWalkSeconds, ends: new Date(clock) };
}

export function PlanScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
            <PlanBody center={gate.center} />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

function PlanBody({ center }: { center: Coordinates }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const items = usePlan();
  const [doors, setDoors] = useState<Door[] | 'loading' | null>(null);

  const lastItem = items[items.length - 1];
  const suggestFrom = lastItem?.coordinates ?? center;
  const excludeKey = items.map((item) => item.id).join(',');

  // The rail: one engine call from wherever the plan leaves you
  const loadDoors = useCallback(async () => {
    // Deferred past the sync phase — React Compiler lint forbids
    // synchronous setState inside effects (house pattern)
    await Promise.resolve();
    setDoors('loading');
    try {
      const plan = await fetchPlan({ center: suggestFrom, duration: 'hour', company: 'solo' });
      setDoors(doorsFromPlan(plan, new Set(excludeKey.split(','))));
    } catch {
      setDoors(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestFrom.latitude, suggestFrom.longitude, excludeKey]);

  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    // Async-IIFE with cancellation — the house effect pattern
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) {
        await loadDoors();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [items.length, loadDoors]);

  if (items.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Plan
        </ThemedText>
        <ThemedText type="largeTitle" style={styles.emptyTitle}>
          Nothing planned yet
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={styles.emptyBody}>
          Tap ＋ Plan on any place or story to start — Venture suggests what fits after, and the
          plan stays here until you clear it.
        </ThemedText>
        {doors === 'loading' ? (
          <ActivityIndicator />
        ) : Array.isArray(doors) && doors.length > 0 ? (
          <View style={styles.doorList}>
            {doors.map((door) => (
              <DoorCard key={door.placeId} door={door} onAdd={() => addToPlan(doorToItem(door))} />
            ))}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={loadDoors}
            style={({ pressed }) => [
              styles.cta,
              { backgroundColor: theme.accent },
              pressed && { opacity: 0.85 },
            ]}>
            <ThemedText type="smallBold" style={styles.ctaText}>
              Suggest a first stop
            </ThemedText>
          </Pressable>
        )}
      </View>
    );
  }

  const { rows, totalWalkSeconds, ends } = computeTimeline(items, center);

  const onShare = () =>
    Share.share({
      message: rows.map(({ item, arrive }) => `${clockLabel(arrive)} — ${item.name}`).join('\n'),
    });

  const onClear = () =>
    Alert.alert('Clear the plan?', undefined, [
      { text: 'Clear', style: 'destructive', onPress: clearPlan },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const renderRow = (item: PlanItem, index: number) => {
    const row = rows[index];
    return (
      <View>
        {row && (
          <View style={styles.legRow}>
            <ThemedText type="small" themeColor="textSecondary">
              {formatWalkTime(row.legSeconds)}{' '}
              <ThemedText
                type="smallBold"
                themeColor="accent"
                onPress={() =>
                  item.kind === 'place' &&
                  router.push({ pathname: '/place/[id]/go', params: { id: item.id } })
                }>
                Go ›
              </ThemedText>
            </ThemedText>
          </View>
        )}
        <View style={styles.stopRow}>
          <ThemedText type="smallBold" themeColor="accent" numberOfLines={1} style={styles.time}>
            {row ? clockLabel(row.arrive) : ''}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              item.kind === 'place'
                ? router.push({ pathname: '/place/[id]', params: { id: item.id } })
                : router.push({
                    pathname: '/history/[pageId]',
                    params: { pageId: item.id.replace('story:', '') },
                  })
            }
            style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <View style={styles.cardHead}>
              <ThemedText type="headline" numberOfLines={1} style={styles.cardName}>
                {item.name}
              </ThemedText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name}`}
                hitSlop={Spacing.two}
                onPress={() => removeFromPlan(item.id)}>
                <ThemedText type="small" themeColor="textSecondary">
                  ✕
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.name} up`}
                disabled={index === 0}
                hitSlop={Spacing.two}
                onPress={() => movePlanItem(index, -1)}>
                <ThemedText type="small" themeColor="textSecondary" style={index === 0 && styles.arrowOff}>
                  ↑
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move ${item.name} down`}
                disabled={index === items.length - 1}
                hitSlop={Spacing.two}
                onPress={() => movePlanItem(index, 1)}>
                <ThemedText
                  type="small"
                  themeColor="textSecondary"
                  style={index === items.length - 1 && styles.arrowOff}>
                  ↓
                </ThemedText>
              </Pressable>
            </View>
            <ThemedText type="small" themeColor="textSecondary">
              {item.facts.join(' · ')}
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Plan
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
          {items.length} {items.length === 1 ? 'stop' : 'stops'} ·{' '}
          {Math.round(totalWalkSeconds / 60)} min walking · ends ~{clockLabel(ends)}
        </ThemedText>
      </View>
      <ScrollView
        contentContainerStyle={[styles.list, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        {items.map((item, index) => (
          <View key={item.id}>{renderRow(item, index)}</View>
        ))}
        {
          <View style={styles.suggest}>
            <ThemedText type="eyebrow" themeColor="textSecondary">
              After this?
            </ThemedText>
            {doors === 'loading' ? (
              <ActivityIndicator style={styles.doorSpinner} />
            ) : Array.isArray(doors) && doors.length > 0 ? (
              <View style={styles.doorList}>
                {doors.map((door) => (
                  <DoorCard
                    key={door.placeId}
                    door={door}
                    onAdd={() => addToPlan(doorToItem(door))}
                  />
                ))}
              </View>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing to suggest right now.
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
                Share plan
              </ThemedText>
            </Pressable>
          </View>
        }
      </ScrollView>
    </View>
  );
}

function DoorCard({ door, onAdd }: { door: Door; onAdd: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onAdd}
      style={[styles.door, { backgroundColor: theme.backgroundElement }]}>
      <Image source={{ uri: door.photoUrl }} style={styles.doorPhoto} contentFit="cover" cachePolicy="memory-disk" />
      <View style={styles.doorBody}>
        <ThemedText type="smallBold">{door.name}</ThemedText>
        {door.why && <ThemedText type="small">{door.why}</ThemedText>}
        <ThemedText type="small" themeColor="textSecondary">
          {[door.primaryLabel, ...door.facts.filter((fact) => fact !== door.primaryLabel)]
            .filter(Boolean)
            .join(' · ')}
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
  list: { paddingHorizontal: Spacing.four, paddingTop: Spacing.two },
  legRow: { paddingLeft: 66 + Spacing.two, paddingVertical: Spacing.one },
  stopRow: { flexDirection: 'row', gap: Spacing.two, alignItems: 'flex-start' },
  time: { width: 66, paddingTop: Spacing.three, fontVariant: ['tabular-nums'] },
  card: { flex: 1, borderRadius: Spacing.three - 2, padding: Spacing.three, gap: Spacing.one },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  cardName: { flex: 1 },
  arrowOff: { opacity: 0.3 },
  suggest: { paddingTop: Spacing.four, gap: Spacing.two },
  doorList: { gap: Spacing.two, alignSelf: 'stretch' },
  door: { borderRadius: Spacing.three - 2, overflow: 'hidden' },
  doorPhoto: { width: '100%', height: 72 },
  doorBody: { padding: Spacing.three, gap: 2 },
  doorSpinner: { paddingVertical: Spacing.three },
  share: {
    marginTop: Spacing.three,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
  empty: { flex: 1, paddingHorizontal: Spacing.five, paddingTop: Spacing.six, gap: Spacing.two },
  emptyTitle: { marginTop: Spacing.one },
  emptyBody: { marginBottom: Spacing.three },
  cta: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
  ctaText: { color: '#FFFFFF' },
});
