import { StyleSheet, Text, type TextProps } from 'react-native';

import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'largeTitle'
    | 'headline'
    | 'eyebrow'
    | 'small'
    | 'smallBold'
    | 'subtitle'
    | 'linkPrimary';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();

  return (
    <Text
      style={[
        { color: theme[themeColor ?? 'text'] },
        type === 'default' && styles.default,
        type === 'largeTitle' && styles.largeTitle,
        type === 'headline' && styles.headline,
        type === 'eyebrow' && styles.eyebrow,
        type === 'small' && styles.small,
        type === 'smallBold' && styles.smallBold,
        type === 'subtitle' && styles.subtitle,
        type === 'linkPrimary' && styles.linkPrimary,
        type === 'linkPrimary' && { color: theme.accent },
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  /** Place names on their own screen — the largest working text. */
  largeTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: 800,
    letterSpacing: -0.5,
  },
  /** Card names and in-screen section headings. */
  headline: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: 700,
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
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: 500,
  },
  subtitle: {
    fontSize: 32,
    lineHeight: 44,
    fontWeight: 600,
  },
  // linkPrimary colour comes from theme.accent in the component
  linkPrimary: {
    lineHeight: 30,
    fontSize: 14,
  },
});
