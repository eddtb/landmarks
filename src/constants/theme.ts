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
    textSecondary: '#7B7E85',
    /** The one interactive colour — buttons, links, selection, the route. */
    accent: '#6A4BDB',
    /** Violet's quiet surface tint — chips, dial rings, soft highlights. */
    accentSoft: '#EFEAFC',
    /** The board's warm accent. Sparing highlights only — never state. */
    accentWarm: '#F0B429',
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

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
