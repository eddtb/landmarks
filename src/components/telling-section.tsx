import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { DrawingWanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { storyParagraphs } from '@/utils/format';
import {
  pauseSpeech,
  resumeSpeech,
  speakAsync,
  speechAvailable,
  speechCanPause,
  stopSpeech,
} from '@/utils/speech';

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

type Status = 'idle' | 'writing' | 'ready' | 'speaking' | 'paused' | 'error' | 'engine-failed';

/**
 * The transport while a telling is being read aloud: Pause · Stop,
 * then Resume · Stop. Two controls, each named in a word (PR #186 —
 * nothing for VoiceOver to call "black square"), and the verb keeps
 * its name through the flow: Pause becomes Resume, Stop stays Stop.
 * Rendered only where the platform can honour a pause
 * (`speechCanPause`); elsewhere the single Stop stands, because a word
 * that does nothing is worse than no word.
 */
export function SpeechControls({
  paused,
  onPause,
  onResume,
  onStop,
  tall = false,
}: {
  paused: boolean;
  onPause: () => Promise<void>;
  onResume: () => Promise<void>;
  onStop: () => Promise<void>;
  /** In the full-width pill the words fill its 44pt height; the inline
   *  rows clear 44pt with vertical slop on the 20px words instead.
   *  Never horizontal slop here — two neighbouring words would fight
   *  over the taps between them. */
  tall?: boolean;
}) {
  const slop = tall ? undefined : { top: Spacing.three, bottom: Spacing.three };
  return (
    <View style={styles.transport}>
      <Pressable
        accessibilityRole="button"
        onPress={() => void (paused ? onResume() : onPause())}
        hitSlop={slop}
        style={[styles.transportWord, tall && styles.transportWordTall]}>
        <ThemedText type="smallBold" themeColor="accent">
          {paused ? 'Resume' : 'Pause'}
        </ThemedText>
      </Pressable>
      {/* Punctuation between the words, not a control — VoiceOver skips it */}
      <ThemedText type="smallBold" themeColor="accent" accessible={false}>
        ·
      </ThemedText>
      <Pressable
        accessibilityRole="button"
        onPress={() => void onStop()}
        hitSlop={slop}
        style={[styles.transportWord, tall && styles.transportWordTall]}>
        <ThemedText type="smallBold" themeColor="accent">
          Stop
        </ThemedText>
      </Pressable>
    </View>
  );
}

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
    // This await holds through a pause — the utterance only settles on
    // done, stop or error — so the continuation below is the one place
    // the outcome is written, whatever state the tap left us in.
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

  const onPause = async () => {
    if ((await pauseSpeech()) === 'paused') {
      setStatus('paused');
    }
    // 'error' keeps the words honest: either the utterance is still
    // audibly speaking (leave 'speaking' standing) or it just ended
    // and speak()'s continuation has already written the outcome.
  };

  const onResume = async () => {
    if ((await resumeSpeech()) === 'speaking') {
      setStatus('speaking');
    }
    // A failed resume settles the pending utterance as 'error' inside
    // resumeSpeech, so speak()'s continuation surfaces engine-failed —
    // the same channel every other engine failure takes.
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

  const reading = status === 'speaking' || status === 'paused';
  return (
    <>
      {reading && speechCanPause ? (
        // The same pill, its words now two controls
        <View style={[styles.button, styles.buttonRow, { backgroundColor: theme.accentSoft }]}>
          <SpeechControls
            paused={status === 'paused'}
            onPause={onPause}
            onResume={onResume}
            onStop={stopSpeech}
            tall
          />
        </View>
      ) : (
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
      )}
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
  const theme = useTheme();
  const [telling, setTelling] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
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
      setPaused(false);
      return;
    }
    if (!telling) {
      return;
    }
    setEngineFailed(false);
    setSpeaking(true);
    setPaused(false);
    // Holds through a pause; settles on done, stop, or error — a
    // resume that fails lands here as 'error' and is said out loud
    const outcome = await speakAsync(telling);
    if (outcome === 'error') {
      setEngineFailed(true);
    }
    setSpeaking(false);
    setPaused(false);
  };

  const pause = async () => {
    if ((await pauseSpeech()) === 'paused') {
      setPaused(true);
    }
  };

  const resume = async () => {
    if ((await resumeSpeech()) === 'speaking') {
      setPaused(false);
    }
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
    // The other long AI wait, and it got bare grey text too (#248).
    // Same line as the retelling's and the cold load's: reduced-motion
    // aware, so it holds still where a spinner would fidget.
    return (
      <View style={styles.leadPending} testID="telling-writing">
        <DrawingWanderLine arcSpan={38} stroke={4.5} count={4} color={theme.accent} />
        <ThemedText type="small" themeColor="textSecondary">
          Writing the telling of {item.title}…
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.lead} testID="telling-lead">
      {/* The control stays ABOVE the prose — you decide whether to listen
          before you start reading. Words, not glyphs (PR #186): no ✦ for
          VoiceOver to call "four-pointed star", and Stop is a word. */}
      {speechAvailable && (
        <View style={styles.leadControl}>
          {speaking && speechCanPause ? (
            <SpeechControls paused={paused} onPause={pause} onResume={resume} onStop={toggle} />
          ) : (
            /* 16pt slop on the 20px label clears the 44pt target */
            <Pressable
              accessibilityRole="button"
              onPress={() => void toggle()}
              hitSlop={Spacing.three}>
              <ThemedText type="smallBold" themeColor="accent">
                {speaking ? 'Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
              </ThemedText>
            </Pressable>
          )}
        </View>
      )}
      {storyParagraphs(telling).map((paragraph, index) => (
        <ThemedText key={index} type={index === 0 ? 'lede' : 'default'}>
          {paragraph}
        </ThemedText>
      ))}
      {/* Attribution goes UNDER the piece, where a byline belongs. It sat
          above, as the first line of every story — so the first thing a
          reader (or an App Review reviewer looking for aggregation) met
          was the app announcing itself as AI output over a web page. The
          disclosure is unchanged and deliberate; only its place is. */}
      <ThemedText type="caption" themeColor="textSecondary" style={styles.leadAttribution}>
        Told by AI from {item.source} — source below
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    // The HIG's 44pt floor, for the whole pill and not just its text
    minHeight: 44,
    paddingVertical: Spacing.two + Spacing.half,
    borderRadius: Spacing.three - Spacing.one,
  },
  // The pill as a row of word-controls: the words themselves carry the
  // height, so the pill's own vertical padding stands down
  buttonRow: {
    flexDirection: 'row',
    paddingVertical: 0,
  },
  transport: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Each word's own padding is its tap target — bounds never overlap
  transportWord: {
    paddingHorizontal: Spacing.two,
  },
  transportWordTall: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  leadPending: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
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
    paddingTop: Spacing.one,
  },
});
