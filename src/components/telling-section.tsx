import { useEffect, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/** The telling, spoken — or read, on clients without the native module. */

type Status = 'idle' | 'writing' | 'ready' | 'speaking' | 'error';

export function TellingSection({ item }: { item: HistoryItem }) {
  const theme = useTheme();
  const [status, setStatus] = useState<Status>('idle');
  const [telling, setTelling] = useState<string | null>(null);

  // Leaving the screen must silence it
  useEffect(() => {
    return () => {
      void stopSpeech();
    };
  }, []);

  const speak = async (text: string) => {
    if (!speechAvailable) {
      setStatus('ready');
      return;
    }
    setStatus('speaking');
    await speakAsync(text);
    setStatus('ready');
  };

  const onPress = async () => {
    if (status === 'speaking') {
      await stopSpeech();
      return;
    }
    if (telling) {
      void speak(telling);
      return;
    }
    setStatus('writing');
    try {
      const text = await fetchTelling(item);
      setTelling(text);
      void speak(text);
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
          : telling && speechAvailable
            ? '🔊 Listen again'
            : '🔊 Listen · about a minute';

  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={status === 'writing' || (telling !== null && !speechAvailable)}
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
