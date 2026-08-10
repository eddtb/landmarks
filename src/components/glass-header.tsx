import { ReactNode } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { ThemedText } from '@/components/themed-text';
import { Glass, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The glass island (Edd's pick from the mocked variants, 2026-08-06):
 * the screen header as a floating liquid-glass capsule, pairing with
 * the tab pill below — two glass objects framing a feed that scrolls
 * under both.
 *
 * Real UIGlassEffect on iOS 26. Everywhere else — older iOS, Android,
 * jest, and every binary built before the module joined — the
 * fallback is a TRANSLUCENT card (Edd, 22:25: the opaque card read as
 * a slab next to the real thing): no blur without native help, but
 * the alpha lets the feed ghost through and the material reads as
 * glass. Native module, so true glass ships in a BINARY — this
 * component is why the OTA cut strips the import.
 *
 * Every material in this file comes from the `Glass` token group and
 * nowhere else. Three surfaces used to hand-roll their own greys.
 */

export const IslandTopGap = Spacing.two;
export const IslandBreath = Spacing.three;
/**
 * How far in from the screen's edges chrome sits — the island's own
 * margin, and the one the floating chips line up with. Named because it
 * was spelled `Spacing.three - 4` in three files, and chrome that does
 * not share an edge reads as two unrelated objects.
 */
export const ChromeEdgeInset = Spacing.three - 4;

/**
 * THE ONE ISLAND INSET. Every screen wearing an island pads its scroll
 * content with this and nothing else.
 *
 * There were three spellings of this measurement — Saved added
 * `insets.top` itself, Nearby let a `SafeAreaView` supply it and passed
 * only the island's height, the Gazetteer passed `topOffset={0}` — and
 * changing the geometry once made two of the three drift. The rule the
 * helper encodes:
 *
 *   MOUNT EVERY ISLAND AS A DIRECT CHILD OF THE SCREEN SURFACE, never
 *   inside a `SafeAreaView`, and pad the content by `useIslandInset`.
 *
 * That way one origin (the screen's true top) serves the island's
 * `top`, which defaults to the same inset, and the content's padding.
 * `topOffset` survives only as the story screen's special case, for a
 * parent that genuinely already sits below the notch.
 */
export function useIslandInset(islandHeight: number) {
  const insets = useSafeAreaInsets();
  return insets.top + islandHeight + IslandBreath;
}

/** The fallback material for chrome over the PAGE: translucent, per scheme. */
function useGlassFallback() {
  const dark = useColorScheme() === 'dark';
  const material = dark ? Glass.page.dark : Glass.page.light;
  return {
    backgroundColor: material.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: material.hairline,
  };
}

/**
 * The raw material in an arbitrary shape: real glass following the
 * app's scheme, or the translucent fallback with its own edge.
 *
 * The island is this plus the island's geometry; Go's chrome over the
 * map is this plus Go's. Go used to carry a third, older copy whose
 * fallback was an opaque `theme.background` slab — the exact material
 * rejected in `ded231b` — and whose glass passed no `colorScheme` at
 * all, so on iOS 26 it sampled a live map and changed its mind as the
 * reader walked.
 */
export function GlassPanel({
  children,
  style,
  /** A control surface reacts to touch; an info surface does not. */
  interactive,
  onLayout,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  interactive?: boolean;
  onLayout?: (height: number) => void;
  testID?: string;
}) {
  const dark = useColorScheme() === 'dark';
  const fallback = useGlassFallback();
  const measure = onLayout
    ? (event: { nativeEvent: { layout: { height: number } } }) =>
        onLayout(event.nativeEvent.layout.height)
    : undefined;

  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        isInteractive={interactive}
        // The content is theme-coloured, so the glass follows the APP
        // scheme rather than sampling whatever is behind it
        colorScheme={dark ? 'dark' : 'light'}
        style={style}
        onLayout={measure}
        testID={testID}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[styles.solid, fallback, style]} onLayout={measure} testID={testID}>
      {children}
    </View>
  );
}

export function GlassIslandHeader({
  children,
  onHeight,
  passThrough,
  topOffset,
}: {
  children: ReactNode;
  /** The island's rendered height (gap above included, breath not). */
  onHeight: (height: number) => void;
  /** An info-only island lets every touch through — a reader must be
   *  able to scroll by dragging across it. */
  passThrough?: boolean;
  /** Distance from the mount parent's top. Defaults to the safe-area
   *  inset — right when the parent starts at the screen's true top
   *  (Yoga anchors absolute children to the border box, ignoring a
   *  SafeAreaView parent's padding), which `useIslandInset` now makes
   *  the only sanctioned arrangement. A parent that already sits below
   *  the notch passes 0, or the island double-insets — sim-caught. */
  topOffset?: number;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.anchor, { top: topOffset ?? insets.top }]}
      pointerEvents={passThrough ? 'none' : 'box-none'}
      testID="glass-island">
      <GlassPanel style={styles.island} onLayout={(height) => onHeight(IslandTopGap + height)}>
        {children}
      </GlassPanel>
    </View>
  );
}

/**
 * The eyebrow's companion: the locator dot and the screen's name, the
 * one title block every standing island wears. Shared so Nearby and
 * Quiz cannot drift into two spellings of one nameplate.
 *
 * The dot means "you are here". It fills only where the app KNOWS: a
 * solid dot over a resolved London name once told a reader in
 * Cupertino they were standing in Charing Cross (#289).
 */
export function IslandTitle({ title, hollow }: { title: string; hollow: boolean }) {
  const theme = useTheme();
  return (
    <View style={styles.titleGroup}>
      <View
        testID="locator-dot"
        style={[
          styles.locatorDot,
          hollow
            ? { backgroundColor: 'transparent', borderWidth: 2, borderColor: theme.textSecondary }
            : { backgroundColor: theme.accent },
        ]}
      />
      <ThemedText type="largeTitle">{title}</ThemedText>
    </View>
  );
}

/**
 * A small floating glass capsule or circle — the story screen's back
 * chevron and ⋯ menu over the full-bleed hero, and the journal tick on
 * a card's photograph. Same material rules as the island.
 */
export function GlassChip({
  children,
  style,
  circle,
  over = 'photo',
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** A 40pt round chip — the chevron and the ⋯ (Edd, 22:25: the
   *  simplified chrome). Round means a LONE GLYPH, which is also what
   *  decides the weight of the scrim below. */
  circle?: boolean;
  /**
   * What the chip sits ON, which is the whole of what decides its
   * material (DESIGN.md, Glass). Over a photograph it pins dark and
   * inks itself; over the page it is an island in miniature and follows
   * the app's scheme. One control, two renderings — pass the tint,
   * don't fork the component. A story screen with no hero has no
   * photograph, and a dark disc under a white chevron floating on a
   * white page is that rule read backwards (#292).
   */
  over?: 'photo' | 'page';
}) {
  const dark = useColorScheme() === 'dark';
  const fallback = useGlassFallback();
  const onPhoto = over === 'photo';
  // A lone glyph on a 40pt circle drowns where a whole worded label
  // survives (Edd, 22:31), so the round chip takes the deeper scrim and
  // the tick the lighter one. The real-glass TINT does not split: its
  // job is to stop the material going light over a bright sky, and that
  // job is the same whatever the chip is carrying.
  const ink = circle
    ? { backgroundColor: Glass.photo.glyphScrim, borderColor: Glass.photo.glyphHairline }
    : { backgroundColor: Glass.photo.labelScrim, borderColor: Glass.photo.labelHairline };

  if (isLiquidGlassAvailable()) {
    return (
      // On a photo the colorScheme is pinned DARK: real glass ADAPTS to
      // its backdrop, and over a bright sky it turned light under our
      // white glyphs — "sometimes right, sometimes not" (Edd, 22:51).
      // Photo chrome is dark by design; the material must agree every
      // time. On the page there is nothing to adapt to but the app.
      <GlassView
        glassEffectStyle="regular"
        colorScheme={onPhoto || dark ? 'dark' : 'light'}
        // Glass is transmissive: a white photo scrolling beneath lifted
        // the whole chip out from under its glyphs (Edd, 22:56). The
        // tint inks the material itself, so the chip stays dark over
        // ANY backdrop and still reads as glass. Over the page the
        // backdrop is already the app's own colour — inking it would
        // paint a dark disc on a white screen, the very complaint.
        tintColor={onPhoto ? Glass.photo.tint : undefined}
        style={[styles.chip, circle && styles.circle, style]}
        testID={testID}>
        {children}
      </GlassView>
    );
  }
  // No glass: a chip over a PHOTO takes the photo-scrim — fixed dark
  // ink with white glyphs whatever the scheme (Edd, 22:27: the scheme
  // surface went navy over a bright sky). Over the page it takes the
  // island's translucency instead, for the same reason the island does:
  // it sits over text, not imagery. Either way it takes the fallback's
  // own edge — a chip over a pale photo had only its hairline, and on
  // Android, which has no shadow without `elevation`, not even that.
  return (
    <View
      testID={testID}
      style={[
        styles.chip,
        circle && styles.circle,
        styles.solid,
        onPhoto ? [styles.scrim, ink] : fallback,
        style,
      ]}>
      {children}
    </View>
  );
}

/**
 * THE back chip. Two screens drew their own circle-with-a-chevron, both
 * claiming `testID="story-back"`, and the 40pt press box was copied
 * into a third file — so a fix to one left the others behind.
 *
 * A screen a reader cannot leave is a trap, so this renders in every
 * state of a story screen, including the failed ones.
 */
export function StoryBackChip({
  backLabel,
  onPress,
  over = 'photo',
}: {
  /** Where back GOES, spoken: "Back to Stories". */
  backLabel: string;
  onPress: () => void;
  over?: 'photo' | 'page';
}) {
  return (
    <GlassChip circle over={over} testID="back-chip">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Back to ${backLabel}`}
        testID="story-back"
        onPress={onPress}
        hitSlop={Spacing.two}
        style={styles.pressBox}>
        <ThemedText type="title" style={[styles.chevron, over === 'photo' && styles.photoGlyph]}>
          ‹
        </ThemedText>
      </Pressable>
    </GlassChip>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: IslandTopGap,
    paddingHorizontal: ChromeEdgeInset,
  },
  chip: {
    borderRadius: Radius.pill,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  circle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The 40pt press box — the chip's whole face is the target. */
  pressBox: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Sized to read as an icon, nudged up — the glyph's baseline sits low
  chevron: {
    lineHeight: 24,
    marginTop: -2,
  },
  /** On the photo scrim the glyph is white whatever the scheme. */
  photoGlyph: {
    color: '#FFFFFF',
  },
  island: {
    borderRadius: Radius.island,
    borderCurve: 'continuous',
    overflow: 'hidden',
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
  solid: {
    // The fallback needs its own edge; real glass draws its own.
    // `elevation` is the Android half of it — without it a chip over a
    // pale photograph had nothing but a hairline there.
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  scrim: {
    borderWidth: StyleSheet.hairlineWidth,
  },
});
