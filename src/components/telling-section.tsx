import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { storyParagraphs } from '@/utils/format';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/**
 * The telling behind a press, for the extract story — a place with no
 * article of its own, which in practice means an unresolved plaque.
 *
 * It stays a button here on purpose. The Gazetteer path leads with
 * authored prose (a retelling, or TellingLead below), but this path's
 * extract IS a plaque's inscription, and a telling written from an
 * inscription speaks past the subject it is quoting — the same rule the
 * Gazetteer's own tellingItem gate enforces. Promoting prose here was
 * tried and reverted: the heading it introduced could not be reached
 * (a Historic England item either resolves to a Wikipedia story or is
 * dropped — see heritage.ts), and the one case that DID reach it was
 * the inscription this rule exists to protect.
 */

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
        ? // A word, not ◼ (PR #186): violet already means tappable
          'Stop'
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
 * Venture's own account of a place, and the opening of every story that
 * isn't led by a full retelling: in the Gazetteer where no retelling
 * earned the place, and on the story screen for a place with no article
 * of its own (a plaque, a Historic England entry). Writes itself on
 * mount — the authored prose is the first thing read, never something
 * a tap has to reveal.
 *
 * Failure is spoken, not swallowed. It used to render null, which left
 * the source extract standing alone as the entire story: the app
 * looking like the aggregator it is not, exactly when App Review was
 * citing 4.2.2 for that.
 */
export function TellingLead({ item }: { item: HistoryItem }) {
  const [telling, setTelling] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [engineFailed, setEngineFailed] = useState(false);
  const [itemFor, setItemFor] = useState<HistoryItem | null>(null);
  const [attempt, setAttempt] = useState(0);

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
  }, [item, attempt]);

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

  // Never silently: a telling that vanishes leaves the source extract
  // standing alone as the whole story, which is the one thing this app
  // is not. Say it failed and offer the retry.
  if (failed) {
    return (
      <View style={styles.lead} testID="telling-failed">
        <ThemedText type="small" themeColor="textSecondary">
          Couldn’t write the telling just now.
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          testID="telling-retry"
          onPress={() => {
            setFailed(false);
            setAttempt((previous) => previous + 1);
          }}
          hitSlop={Spacing.two}>
          <ThemedText type="smallBold" themeColor="accent">
            Write it again
          </ThemedText>
        </Pressable>
      </View>
    );
  }
  if (!telling) {
    return (
      <ThemedText type="small" themeColor="textSecondary" style={styles.leadPending}>
        Writing the telling…
      </ThemedText>
    );
  }
  return (
    <View style={styles.lead} testID="telling-lead">
      {/* The control stays ABOVE the prose — you decide whether to listen
          before you start reading. Words, not glyphs (PR #186): no ✦ for
          VoiceOver to call "four-pointed star", and Stop is a word. */}
      {speechAvailable && (
        <View style={styles.leadControl}>
          {/* 16pt slop on the 20px label clears the 44pt target */}
          <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.three}>
            <ThemedText type="smallBold" themeColor="accent">
              {speaking ? 'Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
            </ThemedText>
          </Pressable>
        </View>
      )}
      {storyParagraphs(telling).map((paragraph, index) => (
        <ThemedText key={index} type="default" style={index === 0 && styles.leadLede}>
          {paragraph}
        </ThemedText>
      ))}
      {/* Attribution goes UNDER the piece, where a byline belongs. It sat
          above, as the first line of every story — so the first thing a
          reader (or an App Review reviewer looking for aggregation) met
          was the app announcing itself as AI output over a web page. The
          disclosure is unchanged and deliberate; only its place is. */}
      <ThemedText type="small" themeColor="textSecondary" style={styles.leadAttribution}>
        Told by AI from {item.source} — source below
      </ThemedText>
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
  // Just the Listen control now, held to the right above the prose
  leadControl: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  // A byline, under the piece
  leadAttribution: {
    fontSize: 11,
    paddingTop: Spacing.one,
  },
  // The same lede treatment a retold part's opening gets — the telling
  // IS the story's opening here
  leadLede: {
    fontSize: 17.5,
    lineHeight: 27,
    fontWeight: '500',
  },
});
