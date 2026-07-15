/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#17181A',
    /** Warm paper, not device white — cards read as white ON it. */
    background: '#FBFAF8',
    /** Card surfaces: true white, lifted off the paper by CardShadow. */
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#ECEAE4',
    textSecondary: '#60646C',
    /** The one interactive colour — links, toggles, walk times, the route line. */
    accent: '#6A4BDB',
    /** Semantic only, never decoration: a venue confirmed open. */
    open: '#1E8A4C',
    /** Semantic only: time-sensitive warnings — closes soon, usually busy. */
    signal: '#B45D09',
    /** Semantic only: a venue confirmed closed. */
    closed: '#A63D3D',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    accent: '#A18BF5',
    open: '#4CC38A',
    signal: '#F0A24A',
    closed: '#E5716F',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

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

/**
 * The soft lift that separates white cards from the paper background.
 * Invisible in dark mode by design (shadows on black do nothing) —
 * there the element colour does the separating.
 */
export const CardShadow = {
  shadowColor: '#17181A',
  shadowOpacity: 0.07,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 3,
} as const;
