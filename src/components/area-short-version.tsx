import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchAreaTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/**
 * The short version (Edd's TL;DR, in the app's own genre): the place
 * gets a telling — sixty seconds in the storyteller's voice, honest
 * about its authorship, sitting ABOVE the encyclopedic intro it was
 * told from, never replacing it. Fails silent: no telling, no block.
 */
export function AreaShortVersion({
  areaName,
  extract,
}: {
  areaName: string;
  extract: string;
}) {
  const theme = useTheme();
  const [telling, setTelling] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      const loaded = await fetchAreaTelling(areaName, extract).catch(() => null);
      if (active) {
        setTelling(loaded);
      }
    })();
    return () => {
      active = false;
      void stopSpeech();
    };
  }, [areaName, extract]);

  if (!telling) {
    return null;
  }

  const onListen = async () => {
    if (speaking) {
      await stopSpeech();
      setSpeaking(false);
      return;
    }
    setSpeaking(true);
    await speakAsync(telling);
    setSpeaking(false);
  };

  return (
    <View style={[styles.block, { backgroundColor: theme.accentSoft }]}>
      <View style={styles.head}>
        <ThemedText type="eyebrow" themeColor="accent" style={styles.title}>
          The short version
        </ThemedText>
        {speechAvailable && (
          <Pressable accessibilityRole="button" onPress={onListen} hitSlop={Spacing.two}>
            <ThemedText type="smallBold" themeColor="accent">
              {speaking ? '◼ Stop' : '🔊 Listen'}
            </ThemedText>
          </Pressable>
        )}
      </View>
      <ThemedText type="default">{telling}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary" style={styles.label}>
        Told by AI from the story below
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three - 2,
    gap: Spacing.two,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  title: {
    flex: 1,
  },
  label: {
    fontSize: 11,
  },
});
