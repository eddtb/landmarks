/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  // The whole palette, by rule: if it isn't interactive and isn't a
  // name it's grey; if it's interactive it's violet. No third case —
  // state is words and dimming, never colour.
  light: {
    text: '#17181A',
    background: '#FFFFFF',
    backgroundElement: '#F2F2F4',
    backgroundSelected: '#E6E6EA',
    // 4.6:1 on white (the old #7B7E85 sat just under AA at ~4.06:1);
    // still comfortably AA on the backgroundElement card surface
    textSecondary: '#6B6E76',
    /** The one interactive colour — buttons, links, selection, the route. */
    accent: '#6A4BDB',
    /** Violet's quiet surface tint — chips, dial rings, soft highlights. */
    accentSoft: '#EFEAFC',
    /**
     * The board's warm accent. Sparing highlights only — never state.
     * Its three sanctioned uses, total: the one-door gate's Enable CTA,
     * the "You're standing on it" banner (approved mock 3), and the
     * quiz's perfect-run banner (approved 2026-08-06, the rebuilt
     * quiz's one extravagance). Yellow is the rarity marker; nothing
     * else earns it.
     */
    accentWarm: '#F0B429',
    /** The warm accent's quiet ground — only under the standing-on banner. */
    warmSoft: '#FDF3D7',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#A18BF5',
    accentSoft: '#332B52',
    accentWarm: '#F6CE5B',
    warmSoft: '#38300F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * The one-door gate's ground — the light theme's accent worn full-bleed
 * in BOTH colour schemes. Deliberately single-look: the dark theme's
 * accent (#A18BF5) fails contrast under white text, and a brand moment
 * may commit to one look.
 */
export const BrandPurple = Colors.light.accent;
/**
 * The gate's one warm action — the light accentWarm in both schemes
 * (same single-look rule), with dark ink text on it.
 */
export const BrandWarm = Colors.light.accentWarm;
/** The ink that sits on BrandWarm. */
export const BrandWarmInk = '#2B1F07';

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * SANCTIONED MATERIAL — deliberately not part of the palette above, and
 * this comment is the reason it is allowed to exist.
 *
 * `Colors` is INK: what the app says. This is GLASS: what the chrome is
 * made OF. Every value here is either the tint that inks real
 * `UIGlassEffect` or the scrim that stands in for it wherever the
 * native module is absent — Android, iOS before 26, jest, and every
 * binary cut before the module joined (DESIGN.md, Glass). None of them
 * can be a `Colors` entry: a translucent material has to be specified
 * as one, and the scrim over a photograph deliberately ignores the
 * theme rather than following it.
 *
 * Three surfaces used to carry three base greys and three alpha pairs.
 * The ALPHAS are reasoned and stay — a lone white glyph on a 40pt chip
 * drowns where a whole worded label survives. The base greys were not
 * reasoned, so there is now exactly one per material, and there are two
 * materials, because the material follows what it sits ON.
 */
export const Glass = {
  /**
   * Chrome sitting on a PHOTOGRAPH pins dark whatever the scheme: real
   * glass adapts to its backdrop, and over a bright sky it turned light
   * beneath our white glyphs. Glyphs on this material are always white.
   */
  photo: {
    /** Inks real glass itself, so the chip stays dark over ANY backdrop. */
    tint: 'rgba(20, 20, 24, 0.65)',
    /** No glass, LONE GLYPH (the 40pt back and ⋯ circles): deep scrim. */
    glyphScrim: 'rgba(20, 20, 24, 0.75)',
    glyphHairline: 'rgba(255, 255, 255, 0.30)',
    /** No glass, WORDED mark (the journal tick): lighter — words hold. */
    labelScrim: 'rgba(20, 20, 24, 0.55)',
    labelHairline: 'rgba(255, 255, 255, 0.25)',
  },
  /**
   * Chrome sitting on the PAGE follows the app's scheme — the island,
   * the chip on a photoless screen, Go's sheet over the map.
   * Translucency and a hairline, NEVER an opaque slab: a slab reads as
   * a card sitting beside the real thing, which is why it was rejected
   * (`ded231b`).
   */
  page: {
    light: { fill: 'rgba(245, 245, 247, 0.88)', hairline: 'rgba(23, 24, 26, 0.10)' },
    dark: { fill: 'rgba(30, 30, 34, 0.86)', hairline: 'rgba(255, 255, 255, 0.12)' },
  },
} as const;

/**
 * The named corners. Radii were the last unnamed geometry sitting
 * beside `IslandTopGap`/`IslandBreath`, so a shape could drift without
 * anyone reading the diff noticing which shape it was.
 */
export const Radius = {
  /** Fully round-ended — the 40pt chip and the journal tick. */
  pill: 999,
  /** The glass island (DESIGN.md, Glass: two shapes, and only two). */
  island: Spacing.four,
  /** A sheet lifted over content — Go's directions sheet. */
  sheet: Spacing.three,
  /** A control card floating over the map — Go's top card. */
  control: Spacing.three - Spacing.one,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
