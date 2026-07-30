import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchTelling } from '@/data/telling-client';
import { HistoryItem } from '@/types/history';
import { storyParagraphs } from '@/utils/format';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

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
      <View style={styles.leadLabel}>
        {/* Words, not glyphs (PR #186): no ✦ for VoiceOver to call
            "four-pointed star", and Stop is a word */}
        <ThemedText type="small" themeColor="textSecondary" style={styles.leadLabelText}>
          Told by AI from {item.source} — original below
        </ThemedText>
        {speechAvailable && (
          // 16pt slop on the 20px label clears the 44pt target
          <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.three}>
            <ThemedText type="smallBold" themeColor="accent">
              {speaking ? 'Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
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
