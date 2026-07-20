import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ColorValue, DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

const AccentTint: ColorValue =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: Colors.light.accent, dark: Colors.dark.accent })
    : Colors.light.accent;

/**
 * The Storyteller has two destinations: the stories around you, and
 * the walk you're building through them. Smaller app, deeper app.
 */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={AccentTint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="walks">
        <NativeTabs.Trigger.Label>Walks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="figure.walk" md="directions_walk" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
