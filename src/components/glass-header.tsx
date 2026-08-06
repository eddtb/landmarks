import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

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
 * Geometry is the screen's business: the island floats at the top of
 * whatever positioned ancestor it is mounted in, reports its height
 * through onHeight, and the screen decides its scroll content's
 * paddingTop. MOUNT AS A DIRECT CHILD of the screen surface: wrapping
 * it in a plain View collapses the positioning context to zero height
 * at the bottom of the flow and the island renders nowhere
 * (sentinel-bisected the hard way).
 */

export const IslandTopGap = Spacing.two;
export const IslandBreath = Spacing.three;

/** The fallback material: translucent, per scheme. */
function useGlassFallback() {
  const dark = useColorScheme() === 'dark';
  return {
    backgroundColor: dark ? 'rgba(30, 30, 34, 0.86)' : 'rgba(245, 245, 247, 0.88)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(23, 24, 26, 0.10)',
  };
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
   *  SafeAreaView parent's padding). A parent that already sits below
   *  the notch passes 0, or the island double-insets — sim-caught. */
  topOffset?: number;
}) {
  const insets = useSafeAreaInsets();
  const fallback = useGlassFallback();
  const glass = isLiquidGlassAvailable();
  const report = (height: number) => onHeight(IslandTopGap + height);

  return (
    <View
      style={[styles.anchor, { top: topOffset ?? insets.top }]}
      pointerEvents={passThrough ? 'none' : 'box-none'}
      testID="glass-island">
      {glass ? (
        <GlassView
          glassEffectStyle="regular"
          style={styles.island}
          onLayout={(event) => report(event.nativeEvent.layout.height)}>
          {children}
        </GlassView>
      ) : (
        <View
          style={[styles.island, styles.solid, fallback]}
          onLayout={(event) => report(event.nativeEvent.layout.height)}>
          {children}
        </View>
      )}
    </View>
  );
}

/**
 * A small floating glass capsule or circle — the story screen's back
 * chevron and ⋯ menu wear these over the full-bleed hero, where the
 * native header used to be. Same material rules as the island.
 */
export function GlassChip({
  children,
  style,
  circle,
}: {
  children: ReactNode;
  style?: object;
  /** A 40pt round chip — the chevron and the ⋯ (Edd, 22:25: the
   *  simplified chrome). */
  circle?: boolean;
}) {
  const glass = isLiquidGlassAvailable();
  if (glass) {
    return (
      <GlassView glassEffectStyle="regular" style={[styles.chip, circle && styles.circle, style]}>
        {children}
      </GlassView>
    );
  }
  // Chips live over PHOTOS, so the fallback is a photo-scrim — fixed
  // dark ink with white glyphs whatever the scheme (Edd, 22:27: the
  // scheme surface went navy over a bright sky). The read tick proved
  // this material; the island keeps scheme translucency, it sits over
  // text, not imagery.
  return (
    <View style={[styles.chip, styles.scrim, circle && styles.circle, style]}>{children}</View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 10,
    paddingTop: IslandTopGap,
    paddingHorizontal: Spacing.three - 4,
  },
  chip: {
    borderRadius: 999,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  circle: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  island: {
    borderRadius: Spacing.four,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  solid: {
    // The fallback card needs its own edge; real glass draws its own
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  // 0.75, not the tick's 0.55: a 40pt chip must hold its own against
  // a bright sky (Edd, 22:31 — at 0.55 the chip washed out and the
  // white chevron drowned); the tick's larger white label survives
  // the lighter scrim, a lone glyph doesn't
  scrim: {
    backgroundColor: 'rgba(20, 20, 24, 0.75)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.30)',
  },
});
