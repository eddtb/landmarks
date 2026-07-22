import AsyncStorage from '@react-native-async-storage/async-storage';
import { PropsWithChildren, useEffect, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { WanderLine } from '@/components/wander-line';
import { BrandPurple, BrandWarm, BrandWarmInk, Spacing } from '@/constants/theme';
import { requestLocationPermission, useLocationPermission } from '@/hooks/use-location';

export const ONE_DOOR_DISMISSED_KEY = 'one-door-dismissed-v1';

/**
 * "Not now", remembered app-wide (the use-pin primitive: a value, a
 * listener set, useSyncExternalStore). Read from AsyncStorage once,
 * `null` while in flight so callers render neither the gate nor the
 * fallback — a returning dismisser never sees a flash of the door. A
 * module store, not per-hook state: the root gate dismisses and the
 * tabs' LocationGates must learn in the same frame.
 */
let dismissed: boolean | null = null;
let readStarted = false;
const listeners = new Set<() => void>();

function setDismissed(next: boolean | null) {
  dismissed = next;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return dismissed;
}

function ensureFlagRead() {
  if (readStarted) {
    return;
  }
  readStarted = true;
  AsyncStorage.getItem(ONE_DOOR_DISMISSED_KEY)
    .then((value) => setDismissed(value === 'true'))
    // Storage broke: show the door — it's the app's one required ask
    .catch(() => setDismissed(false));
}

export function dismissOneDoor() {
  setDismissed(true);
  // Fire-and-forget: worst case the door shows once more next launch
  AsyncStorage.setItem(ONE_DOOR_DISMISSED_KEY, 'true').catch(() => {});
}

/** The shared flag; null while the first read is in flight. */
export function useOneDoorDismissed(): boolean | null {
  useEffect(ensureFlagRead, []);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Tests only: the store is module-level and must not leak between them. */
export function resetOneDoorForTests() {
  dismissed = null;
  readStarted = false;
}

// The gate's cut of the shared wander line (src/components/wander-line
// — extracted from here, pixel-verified in place)
const ArcSpan = 110; // horizontal span of one half-arc
const ArcStroke = 14;
const ArcCount = 6; // covers the widest phone from off-left to off-right

function WanderRun({ top, left, opacity }: { top: number; left: number; opacity: number }) {
  return (
    <WanderLine
      arcSpan={ArcSpan}
      stroke={ArcStroke}
      count={ArcCount}
      color="#FFFFFF"
      style={[styles.run, { top, left, opacity }]}
    />
  );
}

/** The solid run and a faint echo across the upper third. The echo
 * sits fully below the solid band in the same phase, so the two
 * parallel and never cross. Both enter from the left edge and exit
 * right, behind everything. */
function GateWanderLines() {
  return (
    <View
      style={styles.wander}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <WanderRun top={56} left={-30} opacity={0.92} />
      <WanderRun top={56 + ArcSpan + Spacing.two} left={-58} opacity={0.35} />
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
 * non-negotiable ask.
 */
export function OneDoor({ onEnable, onNotNow }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View testID="one-door" style={styles.screen}>
      <GateWanderLines />
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

/**
 * The root overlay — above the tab navigator, below the animated
 * splash. The door must cover the whole app: rendered inside a tab's
 * LocationGate it left the floating tab pill on top and the other tab
 * tappable behind it (sim-caught). Shows only while location
 * permission is undetermined AND "Not now" isn't on record; while
 * either read is in flight it adds nothing, so no flash for any
 * returning user. Enable here is the app's ONE permission-request
 * path — nothing else asks iOS, so no double prompts.
 */
export function OneDoorGate() {
  const doorUp = useOneDoorVisible();

  if (!doorUp) {
    return null;
  }
  return (
    <View
      testID="one-door-overlay"
      style={styles.overlay}
      // Modal to the accessibility tree (iOS): without it the tab
      // items keep their bounds under the gate — taps can't reach
      // them but VoiceOver focus could (sim-caught)
      accessibilityViewIsModal>
      <OneDoor
        onEnable={() => {
          requestLocationPermission();
        }}
        onNotNow={dismissOneDoor}
      />
    </View>
  );
}

/** Whether the door is up — the gate renders on it, and the backdrop
 * hides the app behind it from the accessibility tree with it. */
export function useOneDoorVisible(): boolean {
  const permission = useLocationPermission();
  const doorDismissed = useOneDoorDismissed();
  return permission?.status === 'undetermined' && doorDismissed === false;
}

/**
 * Wraps the app the door covers (_layout puts the whole navigator in
 * here). While the door is up, everything inside leaves the
 * accessibility tree — the Android path and the iOS belt to the
 * overlay's accessibilityViewIsModal braces; the moment the door goes,
 * the app comes straight back.
 */
export function OneDoorBackdrop({ children }: PropsWithChildren) {
  const doorUp = useOneDoorVisible();
  return (
    <View
      testID="one-door-backdrop"
      style={styles.backdrop}
      accessibilityElementsHidden={doorUp}
      importantForAccessibility={doorUp ? 'no-hide-descendants' : 'auto'}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Above the tab pill and every screen, below the animated splash
    // (zIndex 1000) — while the door is up it is the only surface
    zIndex: 500,
  },
  backdrop: {
    flex: 1,
  },
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
