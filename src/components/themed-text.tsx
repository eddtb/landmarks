import { StyleSheet, Text, type TextProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'display'
    | 'largeTitle'
    | 'title'
    | 'headline'
    | 'lede'
    | 'pullQuote'
    | 'eyebrow'
    | 'small'
    | 'smallBold'
    | 'caption'
    | 'captionBold'
    | 'linkPrimary';
  themeColor?: ThemeColor;
};

/**
 * Dynamic type policy (DESIGN.md): reading text scales freely with the
 * user's setting; chrome — labels, buttons, the dial's number, screen
 * titles — caps at 1.4× so accessibility sizes never clip a fixed
 * frame. Overridable per-use via the ordinary maxFontSizeMultiplier prop.
 */
const ChromeCap = 1.4;
const cappedTypes = new Set(['eyebrow', 'smallBold', 'largeTitle', 'display']);

export function ThemedText({
  style,
  type = 'default',
  themeColor,
  maxFontSizeMultiplier,
  ...rest
}: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? (cappedTypes.has(type) ? ChromeCap : undefined)}
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'display' && styles.display,
        type === 'largeTitle' && styles.largeTitle,
        type === 'title' && styles.title,
        type === 'headline' && styles.headline,
        type === 'lede' && styles.lede,
        type === 'pullQuote' && styles.pullQuote,
        type === 'eyebrow' && styles.eyebrow,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'caption' && styles.caption,
        type === 'captionBold' && styles.captionBold,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'linkPrimary' && { color: theme.accent },
        style,
      ]}
      {...rest}
    />
  );
}

/**
 * The whole ramp, named (Edd's ask, 2026-08-06): every size in the
 * app has a tier and a reason; an inline fontSize in a component is
 * drift. One voice — the system sans — at every tier (the serif
 * experiment was mocked both ways and sans won).
 */
const styles = StyleSheet.create({
  /** The one-door gate's brand moment — the largest text anywhere. */
  display: {
    fontSize: 34,
    lineHeight: 38,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  /** Place names on their own screen — the largest working text. */
  largeTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  /** Reading headings: a part's title, a quiz question. Scales freely
   *  with dynamic type — it is read, not operated. */
  title: {
    fontSize: 21,
    lineHeight: 27,
    fontWeight: 700,
  },
  /** Card names and in-screen section headings. */
  headline: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 700,
  },
  /** A story's opening paragraph — the lede treatment. */
  lede: {
    fontSize: 17.5,
    lineHeight: 27,
    fontWeight: 500,
  },
  /** The repeatable line, lifted out of its part. */
  pullQuote: {
    fontSize: 18,
    lineHeight: 25,
    fontWeight: 500,
  },
  /** Quiet uppercase section labels: STORY · WHAT'S ON · REVIEWS. */
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 800,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  small: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 500,
  },
  smallBold: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: 700,
  },
  /** Credits, bylines, hints, download states — the finest print. */
  caption: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 500,
  },
  /** The fine print that must still carry: the read tick, chip labels. */
  captionBold: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: 700,
  },
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  // linkPrimary colour comes from theme.accent in the component
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
  },
});
