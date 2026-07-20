import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';

/**
 * The telling, spoken. expo-speech is a native module: clients built
 * before it existed keep a read-only telling (same session-fallback
 * pattern as AsyncStorage in the walk store).
 */
const Speech = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech') as {
      speak: (
        text: string,
        options?: { onDone?: () => void; onStopped?: () => void; onError?: () => void }
      ) => void;
      stop: () => Promise<void>;
    };
  } catch {
    return null;
  }
})();

type Status = 'idle' | 'writing' | 'ready' | 'speaking' | 'error';

export function TellingSection({ item }: { item: HistoryItem }) {
  const theme = useTheme();
  const [status, setStatus] = useState<Status>('idle');
  const [telling, setTelling] = useState<string | null>(null);

  // Leaving the screen must silence it
  useEffect(() => {
    return () => {
      void Speech?.stop();
    };
  }, []);

  const speak = (text: string) => {
    if (!Speech) {
      setStatus('ready');
      return;
    }
    setStatus('speaking');
    Speech.speak(text, {
      onDone: () => setStatus('ready'),
      onStopped: () => setStatus('ready'),
      onError: () => setStatus('ready'),
    });
  };

  const onPress = async () => {
    if (status === 'speaking') {
      await Speech?.stop();
      setStatus('ready');
      return;
    }
    if (telling) {
      speak(telling);
      return;
    }
    setStatus('writing');
    try {
      const text = await fetchTelling(item);
      setTelling(text);
      speak(text);
    } catch {
      setStatus('error');
    }
  };

  const label =
    status === 'writing'
      ? 'Writing the telling…'
      : status === 'speaking'
        ? '◼ Stop'
        : status === 'error'
          ? 'Couldn’t write the telling — try again'
          : telling && Speech
            ? '🔊 Listen again'
            : '🔊 Listen · about a minute';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={status === 'writing' || (telling !== null && !Speech)}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          { backgroundColor: theme.accentSoft },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold" themeColor="accent">
          {label}
        </ThemedText>
      </Pressable>
      {telling && <ThemedText type="small">{telling}</ThemedText>}
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
});
