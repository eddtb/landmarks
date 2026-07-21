import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { OnboardingGate } from '@/components/onboarding';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // The image viewer's pinch/pan (gesture-handler) requires this at the root
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <OnboardingGate>
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
      </OnboardingGate>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
