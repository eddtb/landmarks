import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ColorValue, DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

const AccentTint: ColorValue =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: Colors.light.accent, dark: Colors.dark.accent })
    : Colors.light.accent;

/**
 * Four questions, four tabs: what can I go see (Nearby —
 * subject-photo stories, findable on arrival), what did I keep
 * (Saved — the shelf the user fills, place-agnostic where the others
 * follow the feet), what happened here (History — the archive,
 * photo optional), and how much of it do I actually know (Quiz — the
 * app asking, rather than telling, about the ground underfoot;
 * rebuilt v1, see quiz-run.tsx).
 */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={AccentTint} minimizeBehavior="onScrollDown">
      {/* Edd's picks from the rendered mocks (round 2, 2026-08-06):
          the compass to go, the mark to keep, the open record, the
          game. Base SF names — iOS fills the selected tab itself. */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="safari" md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bookmark" md="bookmark" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book" md="menu_book" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="quiz">
        <NativeTabs.Trigger.Label>Quiz</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="die.face.5" md="casino" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
