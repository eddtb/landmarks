import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ColorValue, DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

const AccentTint: ColorValue =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: Colors.light.accent, dark: Colors.dark.accent })
    : Colors.light.accent;

/**
 * Three questions, three tabs: what can I go see (Nearby —
 * subject-photo stories, findable on arrival), what did I keep
 * (Saved — the shelf the user fills, place-agnostic where the others
 * follow the feet), and what happened here (History — the archive,
 * photo optional). The fourth question — how much of it do I actually
 * know — is off the air: the Quiz trigger below is `hidden` (not
 * navigable, not even by deep link) while its question design is
 * rebuilt. All quiz code, tests, and the API route stay; it returns
 * by deleting one word.
 */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={AccentTint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="saved">
        <NativeTabs.Trigger.Label>Saved</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="bookmark" md="bookmark" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="building.columns" md="account_balance" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="quiz" hidden>
        <NativeTabs.Trigger.Label>Quiz</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="questionmark.circle" md="quiz" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
