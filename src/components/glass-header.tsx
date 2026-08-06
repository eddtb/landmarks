import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * The glass island (Edd's pick from the mocked variants, 2026-08-06):
 * the screen header as a floating liquid-glass capsule, pairing with
 * the tab pill below — two glass objects framing a feed that scrolls
 * under both.
 *
 * Real UIGlassEffect on iOS 26; anywhere else (older iOS, Android,
 * jest) it degrades to a solid floating card in the theme's surface
 * colour — still modern, never broken. Native module, so this ships
 * in a BINARY: it rides the same build that strips background
 * location, never an OTA.
 *
 * Geometry is the screen's business: the island floats at the top of
 * whatever positioned ancestor it is mounted in (mount it inside your
 * safe area, or offset it yourself), reports its own height through
 * onHeight, and the screen decides its scroll content's paddingTop so
 * the content starts below the island and slides beneath it.
 */

export const IslandTopGap = Spacing.two;
export const IslandBreath = Spacing.three;

export function GlassIslandHeader({
  children,
  onHeight,
  passThrough,
  topOffset,
}: {
  children: ReactNode;
  /** The island's rendered height (gap above included, breath not). */
  onHeight: (height: number) => void;
  /** An info-only island (the gazetteer's) lets every touch through —
   *  a reader must be able to scroll by dragging across it. */
  passThrough?: boolean;
  /** Distance from the mount parent's top. Defaults to the safe-area
   *  inset — right when the parent starts at the screen's true top
   *  (Yoga anchors absolute children to the border box, ignoring a
   *  SafeAreaView parent's padding). A parent that already sits below
   *  the notch (the gazetteer's wrap, a padded-down flow child) passes
   *  0, or the island double-insets — sim-caught. */
  topOffset?: number;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const glass = isLiquidGlassAvailable();
  const report = (height: number) => onHeight(IslandTopGap + height);

  return (
    // Self-offset below the notch: SafeAreaView insets with PADDING,
    // and absolute children anchor to the outer box — top: 0 here is
    // the screen's true top, clock and all (Edd's phone, 21:01 on
    // "Greenwich"). MOUNT AS A DIRECT CHILD of the screen surface:
    // wrapping this in a plain View collapses the positioning context
    // to zero height at the bottom of the flow and the island renders
    // nowhere (the gazetteer's first attempt, sentinel-bisected).
    // Touches beside the island fall through to the list — only the
    // island itself catches, unless passThrough lets everything by.
    <View
      style={[styles.anchor, { top: topOffset ?? insets.top }]}
      pointerEvents={passThrough ? 'none' : 'box-none'}>
      {glass ? (
        <GlassView
          glassEffectStyle="regular"
          style={styles.island}
          onLayout={(event) => report(event.nativeEvent.layout.height)}>
          {children}
        </GlassView>
      ) : (
        <View
          style={[styles.island, styles.solid, { backgroundColor: theme.backgroundElement }]}
          onLayout={(event) => report(event.nativeEvent.layout.height)}>
          {children}
        </View>
      )}
    </View>
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
  island: {
    borderRadius: Spacing.four,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  solid: {
    // The fallback card needs its own edge; real glass draws its own
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
