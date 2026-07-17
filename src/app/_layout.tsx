import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    // The plan's drag-reorder (gesture-handler) requires this at the root
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="place/[id]/index"
          options={{ title: '', headerBackTitle: 'Nearby' }}
        />
        <Stack.Screen name="place/[id]/go" options={{ headerShown: false }} />
        <Stack.Screen
          name="place/[id]/compass"
          options={{ presentation: 'modal', headerShown: false }}
        />
        <Stack.Screen
          name="place/[id]/reviews"
          options={{ title: 'Reviews', headerBackTitle: 'Back' }}
        />
        <Stack.Screen name="stories" options={{ title: 'Stories', headerBackTitle: 'Nearby' }} />
        <Stack.Screen
          name="history/[pageId]/index"
          options={{ title: '', headerBackTitle: 'Stories' }}
        />
        <Stack.Screen name="history/[pageId]/go" options={{ headerShown: false }} />
        <Stack.Screen
          name="history/[pageId]/compass"
          options={{ presentation: 'modal', headerShown: false }}
        />
      </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
