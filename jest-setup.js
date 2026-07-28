/* global jest */
// Disk caches: tests get their own dir, never the dev ledgers
process.env.AI_CACHE_DIR = '.ai-cache-test';
require('react-native-reanimated').setUpTests();

// AsyncStorage is native — the official in-memory mock keeps the
// persisted client caches (src/data/persisted-cache.ts) alive in tests
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Official mock: SafeAreaView renders plain, useSafeAreaInsets returns zeros
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// expo-maps is a native module with no JS fallback — render a plain View
// so component tests can assert the map's presence and props.
// expo-glass-effect is native (iOS 26) — plain View + "unavailable"
// Screens render outside a navigator in tests — always "focused"
jest.mock('expo-router/build/useIsFocused', () => ({ useIsFocused: () => true }));

jest.mock('expo-glass-effect', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    GlassView: (props) => React.createElement(View, props),
    isLiquidGlassAvailable: () => false,
  };
});

// @expo/ui is native (SwiftUI/Compose hosts) — a plain View that keeps
// its props lets tests fire onPressAction directly
jest.mock('@expo/ui/community/menu', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { MenuView: (props) => React.createElement(View, props) };
});

jest.mock('expo-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MockMapView = (props) => React.createElement(View, props);
  return {
    AppleMaps: { View: MockMapView },
    GoogleMaps: { View: MockMapView },
  };
});

// expo-widgets renders a real WidgetKit extension out of process —
// there is no JS runtime for it under test. createWidget hands back the
// same control surface the app talks to, so a screen that pushes a
// snapshot renders instead of exploding. Assertions about WHAT the
// widget is told live in widget-feed-test, which mocks the widget
// module itself and never reaches this.
jest.mock('expo-widgets', () => ({
  createWidget: () => ({
    updateSnapshot: jest.fn(),
    updateTimeline: jest.fn(),
    reload: jest.fn(),
    getTimeline: jest.fn().mockResolvedValue([]),
  }),
  widgetsDirectory: 'file:///widgets',
}));
