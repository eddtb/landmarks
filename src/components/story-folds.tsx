import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChapterFolds } from '@/components/chapter-folds';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { fetchArticle } from '@/data/article-client';
import { Article } from '@/types/article';
import { HistoryItem } from '@/types/history';
import { wikiTitleFromUrl } from '@/utils/format';

/**
 * The full story, folded (mock direction B): fetches the story's own
 * article and hands the chapters to the shared fold list. Only
 * stories with a Wikipedia article fold out; a plaque's inscription
 * IS its whole story.
 */
export function StoryFolds({ item }: { item: HistoryItem }) {
  const title = wikiTitleFromUrl(item.url);
  const [article, setArticle] = useState<Article | null>(null);

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

  return (
    <View>
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.header}>
        The full story · {article.minutes} min read
      </ThemedText>
      <ChapterFolds chapters={chapters} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    marginBottom: Spacing.two,
  },
});
