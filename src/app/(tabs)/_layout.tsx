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
      {/* The field kit (Edd's pick, 2026-08-06): the tools of someone
          out reading the ground — binoculars to find it, the shelf to
          keep it, the scroll for its record, the head that learns it.
          Base SF names, never .fill — iOS fills the selected tab. */}
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="binoculars" md="explore" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="books.vertical" md="collections_bookmark" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="scroll" md="history_edu" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="quiz">
        <NativeTabs.Trigger.Label>Quiz</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="brain.head.profile" md="psychology" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
