import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Article, fetchArticle } from '@/data/article-client';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { wikiTitleFromUrl } from '@/utils/format';

/**
 * The full story, folded (mock direction B): every chapter shows its
 * heading and opening line; tap to unfold the ones you care about.
 * The first chapter arrives open — an invitation, not an index. Only
 * stories with a Wikipedia article fold out; a plaque's inscription
 * IS its whole story.
 */
export function StoryFolds({ item }: { item: HistoryItem }) {
  const theme = useTheme();
  const title = wikiTitleFromUrl(item.url);
  const [article, setArticle] = useState<Article | null>(null);
  const [open, setOpen] = useState<Set<number>>(new Set([0]));

  useEffect(() => {
    if (!title) {
      return;
    }
    let active = true;
    (async () => {
      const loaded = await fetchArticle(title).catch(() => null);
      if (active && loaded) {
        setArticle(loaded);
      }
    })();
    return () => {
      active = false;
    };
  }, [title]);

  if (!title || !article) {
    return null; // no article (or still loading): the intro above stands alone
  }

  // The intro chapter is already on the screen as the story's extract
  const chapters = article.chapters.filter((chapter) => chapter.title !== '');
  if (chapters.length === 0) {
    return null;
  }

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
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.header}>
        The full story · {article.minutes} min read
      </ThemedText>
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
  header: {
    marginBottom: Spacing.two,
  },
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
