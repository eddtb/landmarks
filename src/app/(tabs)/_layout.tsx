import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { ColorValue, DynamicColorIOS, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

/**
 * The active tab tints accent violet, not system blue. A dynamic
 * color lets the iOS glass bar track light/dark natively (no JS
 * re-render); Android's Material bar takes a plain hex.
 */
const AccentTint: ColorValue =
  Platform.OS === 'ios'
    ? DynamicColorIOS({ light: Colors.light.accent, dark: Colors.dark.accent })
    : Colors.light.accent;

/**
 * The five sections as the system tab bar — liquid glass on iOS 26,
 * Material tabs on Android (five is exactly Android's maximum).
 * Sections are the app's top-level navigation; the pills that once
 * squeezed them into a scrolling filter row are gone.
 */
export default function TabsLayout() {
  return (
    <NativeTabs tintColor={AccentTint} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Landmarks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="building.columns" md="account_balance" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="food">
        <NativeTabs.Trigger.Label>Food</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="fork.knife" md="restaurant" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="drinks">
        <NativeTabs.Trigger.Label>Drinks</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="wineglass" md="local_bar" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="activities">
        <NativeTabs.Trigger.Label>Activities</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="ticket" md="local_activity" />
      </NativeTabs.Trigger>
      {/* History left the bar for the Landmarks banner — real estate
          follows frequency, and Plan is the weekly habit */}
      <NativeTabs.Trigger name="plan">
        <NativeTabs.Trigger.Label>Plan</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sparkles" md="auto_awesome" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
