import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { fetchPlan } from '@/data/plan-client';
import { useAreaName } from '@/hooks/use-area-name';
import { useTheme } from '@/hooks/use-theme';
import { Plan, PlanCompany, PlanDuration, PlanStop } from '@/types/plan';
import { clockLabel } from '@/utils/format';
import { Coordinates } from '@/utils/geo';

/**
 * The Plan tab: two one-tap questions, then the composed timeline.
 * Duration and company are different kinds of choice — the clock
 * preselects duration, so the common case is confirm-and-go. The
 * itinerary lives inline (picker → composing → plan) with ✕ back
 * to the questions and ↻ recomposing fresh.
 */

const DurationOptions: { value: PlanDuration; name: string; sub: string }[] = [
  { value: 'hour', name: 'An hour', sub: 'one stop and a story' },
  { value: 'evening', name: 'An evening', sub: '3–4 stops till late' },
  { value: 'halfday', name: 'Half a day', sub: '4–5 stops' },
  { value: 'fullday', name: 'A full day', sub: 'morning till evening' },
];

const CompanyOptions: { value: PlanCompany; name: string; sub: string }[] = [
  { value: 'solo', name: 'Just me', sub: 'wander-friendly' },
  { value: 'date', name: 'A date', sub: 'paced to talk' },
  { value: 'friends', name: 'Friends', sub: 'lively, flexible' },
  { value: 'family', name: 'Family', sub: 'kid-friendly stops' },
];

const ComposeLabels: Record<PlanDuration, string> = {
  hour: 'Compose the hour',
  evening: 'Compose the evening',
  halfday: 'Compose the half-day',
  fullday: 'Compose the day',
};

/** The clock's suggestion: evening after 4pm, a day before 10am. */
export function defaultDuration(now: Date): PlanDuration {
  const hour = now.getHours();
  if (hour >= 16) return 'evening';
  if (hour < 10) return 'fullday';
  return 'halfday';
}

type PlanState =
  | { status: 'picking' }
  | { status: 'composing'; build: boolean }
  | { status: 'ready'; plan: Plan; initialSwaps?: Record<number, number> }
  | { status: 'building'; plan: Plan; step: number; picks: Record<number, number> }
  | { status: 'error' };

export function PlanScreen() {
  return (
    <LocationGate>
      {(gate) => (
        <ThemedView style={styles.container}>
          <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
            <PlanBody center={gate.center} />
          </SafeAreaView>
        </ThemedView>
      )}
    </LocationGate>
  );
}

function PlanBody({ center }: { center: Coordinates }) {
  const theme = useTheme();
  const areaName = useAreaName(center);
  const [duration, setDuration] = useState<PlanDuration>(() => defaultDuration(new Date()));
  const [company, setCompany] = useState<PlanCompany>('solo');
  const [state, setState] = useState<PlanState>({ status: 'picking' });

  const compose = useCallback(
    async (fresh: boolean, build = false) => {
      setState({ status: 'composing', build });
      try {
        const plan = await fetchPlan({ center, duration, company, fresh });
        setState(
          build
            ? { status: 'building', plan, step: 0, picks: {} }
            : { status: 'ready', plan }
        );
      } catch (error) {
        console.warn('Plan composition failed:', error);
        setState({ status: 'error' });
      }
    },
    [center, duration, company]
  );

  if (state.status === 'ready') {
    return (
      <PlanView
        plan={state.plan}
        initialSwaps={state.initialSwaps}
        onClose={() => setState({ status: 'picking' })}
        onRecompose={() => compose(true)}
      />
    );
  }

  if (state.status === 'building') {
    return (
      <BuildStep
        plan={state.plan}
        step={state.step}
        onBack={() =>
          state.step === 0
            ? setState({ status: 'picking' })
            : setState({ ...state, step: state.step - 1 })
        }
        onPick={(rotation) => {
          const picks = { ...state.picks, [state.step]: rotation };
          if (state.step + 1 < state.plan.stops.length) {
            setState({ ...state, picks, step: state.step + 1 });
          } else {
            setState({ status: 'ready', plan: state.plan, initialSwaps: picks });
          }
        }}
      />
    );
  }

  if (state.status === 'composing') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
        <ThemedText type="small" themeColor="textSecondary">
          Composing from what&apos;s really open…
        </ThemedText>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.picker} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <ThemedText type="eyebrow" themeColor="textSecondary">
          Plan
        </ThemedText>
        <View style={styles.titleGroup}>
          <View style={[styles.locatorDot, { backgroundColor: theme.accent }]} />
          <ThemedText type="largeTitle">{areaName ?? 'Near you'}</ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          Composed from what&apos;s really open, starting where you stand
        </ThemedText>
      </View>

      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.question}>
        How long?
      </ThemedText>
      <OptionGrid options={DurationOptions} selected={duration} onSelect={setDuration} />

      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.question}>
        Who with?
      </ThemedText>
      <OptionGrid options={CompanyOptions} selected={company} onSelect={setCompany} />

      {state.status === 'error' && (
        <ThemedText type="small" themeColor="textSecondary" style={styles.error}>
          Couldn&apos;t compose a plan right now — try again.
        </ThemedText>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={() => compose(false)}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: theme.accent },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold" style={styles.ctaText}>
          {ComposeLabels[duration]}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => compose(false, true)}
        hitSlop={Spacing.two}
        style={styles.buildLink}>
        <ThemedText type="smallBold" themeColor="accent">
          or build it together, stop by stop ›
        </ThemedText>
      </Pressable>
    </ScrollView>
  );
}

/**
 * Build mode: 2–3 doors per slot, never a catalogue. The machine
 * can't know you — so taste gets revealed through picks instead of
 * asked for through profiles. Doors are the engine's chosen stop
 * plus its window-fitted understudies; Venture's pick is marked,
 * not imposed. Stepping is instant: no model call, no spinner.
 */
function BuildStep({
  plan,
  step,
  onBack,
  onPick,
}: {
  plan: Plan;
  step: number;
  onBack: () => void;
  onPick: (rotation: number) => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const stop = plan.stops[step];
  const doors = [stop, ...stop.alternates];
  const slotNames: Record<string, string> = {
    coffee: 'Coffee',
    landmark: 'Somewhere to see',
    activity: 'Something to do',
    meal: 'Dinner',
    drink: 'A drink',
  };

  return (
    <View style={styles.container}>
      <View style={styles.planBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={Spacing.two}>
          <ThemedText type="headline" themeColor="textSecondary">
            ‹
          </ThemedText>
        </Pressable>
        <ThemedText type="smallBold">Building the plan</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {step + 1} of {plan.stops.length}
        </ThemedText>
      </View>
      <ScrollView
        contentContainerStyle={[styles.timeline, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            {slotNames[stop.slotKind] ?? stop.slotKind} · around {clockLabel(new Date(stop.arrive))}
          </ThemedText>
        </View>
        {doors.map((door, index) => (
          <Pressable
            key={door.placeId}
            accessibilityRole="button"
            onPress={() => onPick(index)}
            style={[
              styles.door,
              { backgroundColor: theme.backgroundElement },
              index === 0 && { borderColor: theme.accent, borderWidth: 2 },
            ]}>
            <Image source={{ uri: door.photoUrl }} style={styles.doorPhoto} contentFit="cover" cachePolicy="memory-disk" />
            <View style={styles.doorBody}>
              <View style={styles.doorTitleRow}>
                <ThemedText type="headline">{door.name}</ThemedText>
                {index === 0 && (
                  <ThemedText type="eyebrow" themeColor="accent">
                    Venture&apos;s pick
                  </ThemedText>
                )}
              </View>
              {door.why && <ThemedText type="small">{door.why}</ThemedText>}
              <ThemedText type="small" themeColor="textSecondary">
                {[door.primaryLabel, ...door.facts].filter(Boolean).join(' · ')}
              </ThemedText>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function OptionGrid<T extends string>({
  options,
  selected,
  onSelect,
}: {
  options: { value: T; name: string; sub: string }[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.grid}>
      {options.map((option) => {
        const isSelected = option.value === selected;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(option.value)}
            style={[
              styles.option,
              { backgroundColor: isSelected ? theme.accent : theme.backgroundElement },
            ]}>
            <ThemedText type="smallBold" style={isSelected ? styles.optionSelectedText : undefined}>
              {option.name}
            </ThemedText>
            <ThemedText
              type="small"
              themeColor={isSelected ? undefined : 'textSecondary'}
              style={isSelected ? styles.optionSelectedSub : undefined}>
              {option.sub}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The composed timeline: violet times on a rail, whys and facts apart. */
function PlanView({
  plan,
  initialSwaps,
  onClose,
  onRecompose,
}: {
  plan: Plan;
  initialSwaps?: Record<number, number>;
  onClose: () => void;
  onRecompose: () => void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Swapping rotates a stop through [chosen, ...alternates] — the
  // understudies were fitted to the same window, so times hold
  const [swaps, setSwaps] = useState<Record<number, number>>(initialSwaps ?? {});

  const stopAt = (index: number): PlanStop => {
    const stop = plan.stops[index];
    // The cycle includes the original: chosen -> alt1 -> alt2 -> chosen
    const rotation = (swaps[index] ?? 0) % (stop.alternates.length + 1);
    if (rotation === 0) {
      return stop;
    }
    const alternate = stop.alternates[rotation - 1];
    return { ...stop, ...alternate, why: alternate.why, alternates: stop.alternates };
  };

  const onShare = () => {
    const lines = plan.stops.map((_, index) => {
      const stop = stopAt(index);
      return `${clockLabel(new Date(stop.arrive))} — ${stop.name}`;
    });
    Share.share({ message: `${plan.title}\n${lines.join('\n')}` });
  };

  return (
    <View style={styles.container}>
      <View style={styles.planBar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to questions" onPress={onClose} hitSlop={Spacing.two}>
          <ThemedText type="headline" themeColor="textSecondary">
            ✕
          </ThemedText>
        </Pressable>
        <ThemedText type="smallBold">{plan.title}</ThemedText>
        <Pressable accessibilityRole="button" accessibilityLabel="Recompose" onPress={onRecompose} hitSlop={Spacing.two}>
          <ThemedText type="headline" themeColor="accent">
            ↻
          </ThemedText>
        </Pressable>
      </View>
      <ScrollView
        contentContainerStyle={[styles.timeline, { paddingBottom: Spacing.four + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <ThemedText type="small" themeColor="textSecondary">
          {plan.stops.length} stops · {Math.round(plan.totalWalkSeconds / 60)} min walking ·{' '}
          {clockLabel(new Date(plan.start))} – {clockLabel(new Date(plan.end))}
        </ThemedText>
        {plan.note && (
          <ThemedText type="small" themeColor="textSecondary">
            {plan.note}
          </ThemedText>
        )}

        {plan.stops.map((_, index) => {
          const stop = stopAt(index);
          const leg = plan.legs[index];
          return (
            <View key={`${index}-${stop.placeId}`}>
              <View style={styles.legRow}>
                <View style={[styles.railLine, { backgroundColor: theme.backgroundSelected }]} />
                <View style={styles.legText}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {Math.max(1, Math.round(leg.seconds / 60))} min walk
                    {leg.note ? ` — ${leg.note}` : ''}{' '}
                    <ThemedText
                      type="smallBold"
                      themeColor="accent"
                      onPress={() =>
                        router.push({ pathname: '/place/[id]/go', params: { id: stop.placeId } })
                      }>
                      Go ›
                    </ThemedText>
                  </ThemedText>
                  {leg.story && (
                    <ThemedText type="small">
                      {leg.story.hook ?? `You'll pass ${leg.story.title}.`}
                    </ThemedText>
                  )}
                </View>
              </View>
              <View style={styles.stopRow}>
                <ThemedText
                  type="smallBold"
                  themeColor="accent"
                  numberOfLines={1}
                  style={styles.stopTime}>
                  {clockLabel(new Date(stop.arrive))}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push({ pathname: '/place/[id]', params: { id: stop.placeId } })
                  }
                  style={[styles.stopCard, { backgroundColor: theme.backgroundElement }]}>
                  <ThemedText type="headline">{stop.name}</ThemedText>
                  {stop.why && <ThemedText type="small">{stop.why}</ThemedText>}
                  <ThemedText type="small" themeColor="textSecondary">
                    {[stop.primaryLabel, ...stop.facts].filter(Boolean).join(' · ')}
                  </ThemedText>
                  {plan.stops[index].alternates.length > 0 && (
                    <ThemedText
                      type="smallBold"
                      themeColor="accent"
                      onPress={() =>
                        setSwaps((current) => ({ ...current, [index]: (current[index] ?? 0) + 1 }))
                      }>
                      Swap
                    </ThemedText>
                  )}
                </Pressable>
              </View>
            </View>
          );
        })}

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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
  },
  picker: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.six,
  },
  header: {
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  titleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  locatorDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  question: {
    marginTop: Spacing.four,
    marginBottom: Spacing.two,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  option: {
    width: '48%',
    flexGrow: 1,
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: 2,
  },
  optionSelectedText: {
    color: '#FFFFFF',
  },
  optionSelectedSub: {
    color: 'rgba(255,255,255,0.75)',
  },
  error: {
    marginTop: Spacing.three,
  },
  cta: {
    marginTop: Spacing.four,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
  ctaText: {
    color: '#FFFFFF',
  },
  planBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  timeline: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  legRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingLeft: Spacing.four,
  },
  railLine: {
    width: 2,
    borderRadius: 1,
  },
  legText: {
    flex: 1,
    paddingVertical: Spacing.two,
    gap: Spacing.half,
  },
  stopRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'flex-start',
  },
  stopTime: {
    // Wide enough for "12:45pm" at bold — 52 wrapped the trailing m
    width: 66,
    paddingTop: Spacing.three,
    fontVariant: ['tabular-nums'],
  },
  stopCard: {
    flex: 1,
    borderRadius: Spacing.three - 2,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  buildLink: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
  },
  door: {
    borderRadius: Spacing.three - 2,
    overflow: 'hidden',
  },
  doorPhoto: {
    width: '100%',
    height: 96,
  },
  doorBody: {
    padding: Spacing.three,
    gap: Spacing.one,
  },
  doorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    flexWrap: 'wrap',
  },
  share: {
    marginTop: Spacing.three,
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three - Spacing.one,
  },
});
