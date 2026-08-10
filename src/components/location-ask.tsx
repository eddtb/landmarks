import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { PlaceSearch } from '@/components/place-search';
import { ThemedText } from '@/components/themed-text';
import { WanderLine } from '@/components/wander-line';
import { Radius, Spacing } from '@/constants/theme';
import { requestLocationPermission } from '@/hooks/use-location';
import { useTheme } from '@/hooks/use-theme';
import { Coordinates } from '@/utils/geo';

/**
 * The two remedies, and they are not interchangeable (#290).
 *
 * NEVER ASKED gets the ask: iOS will still show its own prompt, and
 * until an app has requested authorisation once there is no Location
 * row on its Settings page to send anybody to. ASKED AND REFUSED gets
 * Settings, because iOS will not prompt a second time. The old banner
 * gave both the second answer, and for the never-asked majority every
 * clause of it was false.
 */

/**
 * The in-app ask — the second call site `requestLocationPermission()`
 * has wanted since "Not now" became a one-way door.
 *
 * The label names the MECHANISM and never the answer. App Review
 * rejected 1.0(8) under 5.1.1(iv) for a pre-permission button that
 * directed the user to grant, and the surrounding copy carries the
 * reason instead — see the PR for the reading that settled this
 * wording.
 */
export function AskForLocation({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Pressable
      testID="ask-for-location"
      accessibilityRole="button"
      accessibilityLabel="Ask for my location"
      onPress={() => {
        void requestLocationPermission();
      }}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: theme.accent },
        pressed && { opacity: 0.9 },
        style,
      ]}>
      {/* theme.background on the accent, never white: #FFFFFF on the
          dark accent is 2.79:1 (DESIGN.md) */}
      <ThemedText type="smallBold" style={{ color: theme.background }}>
        Ask for my location
      </ThemedText>
    </Pressable>
  );
}

/**
 * The Settings door, as a control: violet, 44pt, and announced. It was
 * grey words buried mid-sentence in a `ThemedText onPress` with no
 * role and no hit area — the one control that recovers location
 * neither looked nor announced as one. Compass and Go wore two more
 * versions of the same fault; all three take this.
 */
export function OpenSettings({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Pressable
      testID="open-settings"
      accessibilityRole="button"
      accessibilityLabel="Open Settings"
      hitSlop={Spacing.two}
      onPress={() => {
        void Linking.openSettings();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: theme.accentSoft },
        pressed && { opacity: 0.85 },
        style,
      ]}>
      <ThemedText type="smallBold" themeColor="accent">
        Open Settings
      </ThemedText>
    </Pressable>
  );
}

/**
 * What a screen shows instead of somebody else's surroundings: the
 * wander line, what this screen would do with a position, and the way
 * forward — the ask where iOS will still prompt, the search field
 * where it will not. The approved direction (mocks A1/A2): the feed
 * stands down entirely and becomes one invitation.
 */
export function LocationInvitation({
  askable,
  heading,
  lede,
  onManualCenter,
  style,
}: {
  /** iOS will still show its prompt: the ask is the way forward. */
  askable: boolean;
  heading: string;
  lede: string;
  onManualCenter: (center: Coordinates, label?: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  // Refused: the field IS the way forward, so it stands open. Never
  // asked: the ask leads and the field waits behind one word.
  const [searchOpen, setSearchOpen] = useState(false);
  const showSearch = !askable || searchOpen;

  return (
    <View testID="location-invitation" style={[styles.invitation, style]}>
      {/* Static — an invitation shouldn't fidget */}
      <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
      <ThemedText type="headline" style={styles.copy}>
        {heading}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.copy}>
        {lede}
      </ThemedText>
      {askable && <AskForLocation style={styles.wide} />}
      {showSearch ? (
        <View style={styles.wide}>
          <PlaceSearch onManualCenter={onManualCenter} autoFocus={searchOpen} />
        </View>
      ) : (
        <Pressable
          testID="invitation-search-instead"
          accessibilityRole="button"
          onPress={() => setSearchOpen(true)}
          hitSlop={Spacing.two}
          style={styles.tapLine}>
          <ThemedText type="linkPrimary">Search a place instead</ThemedText>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 48,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minHeight: 44,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three + 2,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitation: {
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  copy: {
    textAlign: 'center',
    maxWidth: 300,
  },
  wide: {
    alignSelf: 'stretch',
  },
  tapLine: {
    minHeight: 44,
    justifyContent: 'center',
  },
});
