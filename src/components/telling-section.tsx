import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { storyParagraphs } from '@/utils/format';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/** The telling, spoken — or read, on clients without the native module. */

type Status = 'idle' | 'writing' | 'ready' | 'speaking' | 'error' | 'engine-failed';

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
    const outcome = await speakAsync(text);
    setStatus(outcome === 'error' ? 'engine-failed' : 'ready');
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
        : status === 'engine-failed'
          ? 'The speech engine failed — tap to retry (is silent mode on?)'
        : status === 'error'
          ? 'Couldn’t write the telling — try again'
          : telling && speechAvailable
            ? 'Listen again'
            : 'Listen · about a minute';

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

/**
 * The auto-written lead above a fallback article: where no retelling
 * earned the place, the short telling opens the story instead of raw
 * Wikipedia. Writes itself on mount; failure renders nothing — the
 * full article below stands either way, the telling never gates the
 * read.
 */
export function TellingLead({ item }: { item: HistoryItem }) {
  const [telling, setTelling] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [engineFailed, setEngineFailed] = useState(false);
  const [itemFor, setItemFor] = useState<HistoryItem | null>(null);

  // Adjust-during-render (the Gazetteer's own pattern): a new place
  // must not show the last one's telling while its own writes
  if (itemFor !== item) {
    setItemFor(item);
    setTelling(null);
    setFailed(false);
  }

  // Leaving the screen must silence it
  useEffect(() => {
    return () => {
      void stopSpeech();
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetchTelling(item)
      .then((text) => {
        if (active) {
          setTelling(text);
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
    };
  }, [item]);

  const toggle = async () => {
    if (speaking) {
      await stopSpeech();
      setSpeaking(false);
      return;
    }
    if (!telling) {
      return;
    }
    setEngineFailed(false);
    setSpeaking(true);
    const outcome = await speakAsync(telling);
    if (outcome === 'error') {
      setEngineFailed(true);
    }
    setSpeaking(false);
  };

  if (failed) {
    return null;
  }
  if (!telling) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.leadPending}>
        ✦ Writing the telling…
      </ThemedText>
    );
  }
  return (
    <View style={styles.lead} testID="telling-lead">
      <View style={styles.leadLabel}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.leadLabelText}>
          ✦ Told by AI from Wikipedia — original below
        </ThemedText>
        {speechAvailable && (
          <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.two}>
            <ThemedText type="smallBold" themeColor="accent">
              {speaking ? '◼ Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
            </ThemedText>
          </Pressable>
        )}
      </View>
      {storyParagraphs(telling).map((paragraph, index) => (
        <ThemedText key={index} type="default" style={index === 0 && styles.leadLede}>
          {paragraph}
        </ThemedText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  leadPending: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  lead: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two + Spacing.half,
    gap: Spacing.three,
  },
  leadLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  leadLabelText: {
    flex: 1,
    fontSize: 11,
  },
  // The same lede treatment a retold part's opening gets — the telling
  // IS the story's opening here
  leadLede: {
    fontSize: 17.5,
    lineHeight: 27,
    fontWeight: '500',
  },
});
