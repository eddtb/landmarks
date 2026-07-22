import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BrandPurple, BrandWarm, BrandWarmInk, Spacing } from '@/constants/theme';

export const ONE_DOOR_DISMISSED_KEY = 'one-door-dismissed-v1';

/**
 * "Not now" is remembered the way OnboardingGate's seen-flag was: read
 * async at boot, `null` while in flight so the caller renders neither
 * the gate nor the fallback — a returning dismisser never sees a flash
 * of the door. The flag only matters while iOS still reports the
 * permission undetermined; once the user has answered the system
 * dialog, LocationGate's status logic makes the door unreachable.
 */
export function useOneDoorDismissed(): { dismissed: boolean | null; dismiss: () => void } {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(ONE_DOOR_DISMISSED_KEY)
      .then((value) => {
        if (!cancelled) setDismissed(value === 'true');
      })
      // Storage broke: show the door — it's the app's one required ask
      .catch(() => {
        if (!cancelled) setDismissed(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = () => {
    setDismissed(true);
    // Fire-and-forget: worst case the door shows once more next launch
    AsyncStorage.setItem(ONE_DOOR_DISMISSED_KEY, 'true').catch(() => {});
  };

  return { dismissed, dismiss };
}

// The wander line, drawn with primitives (react-native-svg is a native
// module — rebuild cost — and the dependency diet forbids it when
// Views suffice). Each loop is a bordered circle with the opening
// side's border transparent; alternating openings, overlapped
// horizontally, read as the mock's looping run.
const LoopDiameter = 110;
const LoopStroke = 14;
const LoopOverlap = 40;
const LoopCount = 8;

function WanderRun({ top, left, opacity }: { top: `${number}%`; left: number; opacity: number }) {
  return (
    <View style={[styles.run, { top, left, opacity }]}>
      {Array.from({ length: LoopCount }, (_, index) => (
        <View
          key={index}
          style={[
            styles.loop,
            index > 0 && { marginLeft: -LoopOverlap },
            // Alternate the opening: up, down, up… — the looping run
            index % 2 === 0
              ? { borderTopColor: 'transparent' }
              : { borderBottomColor: 'transparent' },
          ]}
        />
      ))}
    </View>
  );
}

/** Two runs across the upper third — one near-solid, one faint echo —
 * entering from the left edge and exiting right, behind everything. */
function WanderLine() {
  return (
    <View
      style={styles.wander}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <WanderRun top="6%" left={-30} opacity={0.92} />
      <WanderRun top="17%" left={-70} opacity={0.35} />
    </View>
  );
}

type Props = {
  /** The yellow pill — hands off to the system location dialog. */
  onEnable: () => void;
  /** The quiet no-path — remembered, then the denied-state search. */
  onNotNow: () => void;
};

/**
 * The one door (approved round-2 Option A): the single first-run gate,
 * replacing both the three-card onboarding overlay and the old
 * location-priming screen. Full-bleed brand purple, the wander line in
 * the upper third, the premise in a breath, and the app's only
 * non-negotiable ask — shown only while location permission is still
 * undetermined and "Not now" hasn't been chosen before.
 */
export function OneDoor({ onEnable, onNotNow }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View testID="one-door" style={styles.screen}>
      <WanderLine />
      <View style={[styles.content, { paddingBottom: insets.bottom + Spacing.five }]}>
        <ThemedText type="eyebrow" style={styles.brandmark}>
          VENTURE
        </ThemedText>
        <ThemedText accessibilityRole="header" style={styles.title}>
          The history within a walk of you
        </ThemedText>
        <ThemedText type="small" style={styles.body}>
          Palaces, ships, plaques, vanished things — the stories of wherever you stand. Venture
          needs your location to find them.
        </ThemedText>
        <Pressable
          testID="one-door-enable"
          accessibilityRole="button"
          accessibilityLabel="Enable location"
          onPress={onEnable}
          style={({ pressed }) => [styles.enable, pressed && { opacity: 0.9 }]}>
          <ThemedText type="smallBold" style={styles.enableText}>
            Enable location
          </ThemedText>
        </Pressable>
        <Pressable
          testID="one-door-not-now"
          accessibilityRole="button"
          accessibilityLabel="Not now — search a place instead"
          onPress={onNotNow}
          hitSlop={Spacing.two}
          style={({ pressed }) => [styles.notNow, pressed && { opacity: 0.8 }]}>
          <ThemedText type="smallBold" style={styles.notNowText}>
            Not now — search a place instead
          </ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BrandPurple,
    overflow: 'hidden',
  },
  wander: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  run: {
    position: 'absolute',
    flexDirection: 'row',
  },
  loop: {
    width: LoopDiameter,
    height: LoopDiameter,
    borderRadius: LoopDiameter / 2,
    borderWidth: LoopStroke,
    borderColor: '#FFFFFF',
  },
  // Bottom-anchored, per the mock: the copy and actions sit in the
  // lower half, under the line's run
  content: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three - Spacing.one,
  },
  brandmark: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 34,
    lineHeight: 38,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  body: {
    color: 'rgba(255, 255, 255, 0.82)',
    maxWidth: 320,
  },
  enable: {
    marginTop: Spacing.two,
    backgroundColor: BrandWarm,
    borderRadius: 999,
    paddingVertical: Spacing.three - Spacing.half,
    alignItems: 'center',
  },
  enableText: {
    color: BrandWarmInk,
  },
  notNow: {
    alignItems: 'center',
    paddingTop: Spacing.one,
  },
  notNowText: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
});
