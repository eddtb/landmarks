import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OneDoorGate } from '@/components/one-door';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // The image viewer's pinch/pan (gesture-handler) requires this at the root
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="history/[pageId]/index"
          options={{ title: '', headerBackTitle: 'Stories' }}
        />
        <Stack.Screen
          name="history/[pageId]/go"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack>
      {/* The one door covers EVERYTHING (tab pill included) while
          location permission is undetermined — inside a tab's
          LocationGate the pill floated on top of it (sim-caught) */}
      <OneDoorGate />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
