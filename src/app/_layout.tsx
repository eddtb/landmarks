import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
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
        <Stack.Screen name="history/[pageId]" options={{ title: '', headerBackTitle: 'Nearby' }} />
      </Stack>
    </ThemeProvider>
  );
}
