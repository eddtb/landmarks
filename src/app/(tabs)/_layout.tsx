import { NativeTabs } from 'expo-router/unstable-native-tabs';

/**
 * The five sections as the system tab bar — liquid glass on iOS 26,
 * Material tabs on Android (five is exactly Android's maximum).
 * Sections are the app's top-level navigation; the pills that once
 * squeezed them into a scrolling filter row are gone.
 */
export default function TabsLayout() {
  return (
    <NativeTabs minimizeBehavior="onScrollDown">
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
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="book" md="menu_book" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
