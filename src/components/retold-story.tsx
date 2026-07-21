import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ChapterFolds } from '@/components/chapter-folds';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Article } from '@/data/article-client';
import { Retold } from '@/data/retold-client';
import { useTheme } from '@/hooks/use-theme';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/**
 * The retold story as the main event (Edd's design, mock 8b92ec46):
 * titled parts at reading size (the images live in the gallery above
 * — Edd's ruling), AI authorship labelled at the top, 🔊 reading the whole thing — and the untouched original
 * behind a door at the end. The retelling improves the read; the
 * original remains the record.
 */

const PartWords = [
  'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

export function RetoldStory({ retold, article }: { retold: Retold; article: Article }) {
  const theme = useTheme();
  const [speaking, setSpeaking] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
      void stopSpeech();
    };
  }, []);

  const onListen = async () => {
    if (speaking) {
      cancelled.current = true;
      await stopSpeech();
      setSpeaking(false);
      return;
    }
    cancelled.current = false;
    setSpeaking(true);
    for (const [index, part] of retold.parts.entries()) {
      if (cancelled.current) {
        return;
      }
      await speakAsync(`Part ${index + 1}: ${part.heading}.`);
      if (cancelled.current) {
        return;
      }
      await speakAsync(part.body);
    }
    if (!cancelled.current) {
      setSpeaking(false);
    }
  };

  const intro = article.chapters.find((chapter) => chapter.title === '')?.paragraphs ?? [];
  const chapters = article.chapters.filter((chapter) => chapter.title !== '');

  return (
    <View>
      <View style={styles.aiLabel}>
        <ThemedText type="small" themeColor="textSecondary" style={styles.aiLabelText}>
          ✦ Retold by AI from Wikipedia — original below
        </ThemedText>
        {speechAvailable && (
          <Pressable accessibilityRole="button" onPress={onListen} hitSlop={Spacing.two}>
            <ThemedText type="smallBold" themeColor="accent">
              {speaking ? '◼ Stop' : '🔊 Listen'}
            </ThemedText>
          </Pressable>
        )}
      </View>
      <View style={styles.body}>
        {retold.parts.map((part, index) => (
          <View key={`${index}-${part.heading}`}>
            {index > 0 && <View style={[styles.rule, { backgroundColor: theme.backgroundElement }]} />}
            <ThemedText type="eyebrow" themeColor="accent" style={styles.partNum}>
              Part {PartWords[index] ?? index + 1}
            </ThemedText>
            <ThemedText type="headline" style={styles.partHead}>
              {part.heading}
            </ThemedText>
            {part.body.split(/\n+/).map((paragraph, paragraphIndex) => (
              <ThemedText key={paragraphIndex} type="default" style={styles.para}>
                {paragraph}
              </ThemedText>
            ))}
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOriginalOpen((open) => !open)}
        style={({ pressed }) => [
          styles.door,
          { backgroundColor: theme.accentSoft },
          pressed && { opacity: 0.85 },
        ]}>
        <ThemedText type="smallBold" themeColor="accent">
          {originalOpen ? 'Hide the original article ⌄' : 'Read the original article ›'}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Wikipedia · {article.minutes} min
        </ThemedText>
      </Pressable>
      {originalOpen && (
        <View style={styles.body}>
          {intro.map((paragraph, index) => (
            <ThemedText key={index} type="default" style={styles.para}>
              {paragraph}
            </ThemedText>
          ))}
          <ChapterFolds chapters={chapters} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  aiLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two + Spacing.half,
  },
  aiLabelText: {
    flex: 1,
    fontSize: 11,
  },
  body: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
  },
  rule: {
    height: 1,
    marginTop: Spacing.two,
    marginBottom: Spacing.four,
  },
  partNum: {
    marginBottom: 2,
  },
  partHead: {
    fontSize: 21,
    lineHeight: 26,
    marginBottom: Spacing.two,
  },
  para: {
    marginBottom: Spacing.three,
  },
  door: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three - 2,
  },
});
