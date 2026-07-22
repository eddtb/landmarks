import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ArticleChapter } from '@/types/article';

/**
 * The fold list (mock direction B, now shared): chapters collapsed to
 * heading + first-line peek, tap to unfold, several open at once.
 * Story screens and the Gazetteer both read through this.
 */
export function ChapterFolds({ chapters }: { chapters: ArticleChapter[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState<Set<number>>(new Set([0]));

  const toggle = (index: number) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  return (
    <View>
      {chapters.map((chapter, index) => {
        const isOpen = open.has(index);
        return (
          <View
            key={`${index}-${chapter.title}`}
            style={[styles.fold, { borderTopColor: theme.backgroundElement }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${isOpen ? 'Collapse' : 'Expand'} ${chapter.title}`}
                onPress={() => toggle(index)}>
                <View style={styles.foldHead}>
                  <ThemedText type="headline" style={styles.foldTitle} numberOfLines={1}>
                    {chapter.title}
                  </ThemedText>
                  <ThemedText type="smallBold" themeColor="accent">
                    {isOpen ? '⌄' : '›'}
                  </ThemedText>
                </View>
                {!isOpen && (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                    {chapter.paragraphs[0]}
                  </ThemedText>
                )}
              </Pressable>
              {isOpen &&
                chapter.paragraphs.map((paragraph, paragraphIndex) => (
                  <ThemedText key={paragraphIndex} type="default" style={styles.para}>
                    {paragraph}
                  </ThemedText>
                ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  fold: {
    borderTopWidth: 1,
    paddingVertical: Spacing.three,
    gap: Spacing.one,
  },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  foldTitle: {
    flex: 1,
  },
  para: {
    marginTop: Spacing.two,
  },
});
