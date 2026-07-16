/* global jest */
require('react-native-reanimated').setUpTests();

// Official mock: SafeAreaView renders plain, useSafeAreaInsets returns zeros
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);

// expo-maps is a native module with no JS fallback — render a plain View
// so component tests can assert the map's presence and props.
// expo-glass-effect is native (iOS 26) — plain View + "unavailable"
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
