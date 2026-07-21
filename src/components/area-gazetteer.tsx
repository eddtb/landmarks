import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChapterFolds } from '@/components/chapter-folds';
import { HistoryCard } from '@/components/history-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Article, ArticleImage, fetchArticle } from '@/data/article-client';
import { usePlan } from '@/hooks/use-plan';
import { HistoryItem } from '@/types/history';
import { historyTag } from '@/utils/format';

/**
 * The Gazetteer (Edd's pick, mock direction A): a magazine cover for
 * the place. The area's full illustrated story — hero from the
 * article's own images, intro at reading size, chapters as folds with
 * images threaded between — and beneath it, the relics of this ground
 * in tagged sections. One glorious scroll: the place, then its ghosts.
 */

type Row =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'relic'; key: string; item: HistoryItem };

/**
 * Pure and unit-tested: relics grouped lost-first, with counts.
 * Plaques are their own section — a plaque is a PRESENT, findable
 * artifact whose inscription happens to speak in the past tense
 * ("was cast in 1790…"); grammar tests don't apply to it.
 */
export function gazetteerRows(relics: HistoryItem[]): Row[] {
  const plaques = relics.filter((item) => item.source.startsWith('Open Plaques'));
  const articles = relics.filter((item) => !item.source.startsWith('Open Plaques'));
  const lost = articles.filter((item) => historyTag(item.extract) === 'Lost');
  const hidden = articles.filter((item) => historyTag(item.extract) !== 'Lost');
  const rows: Row[] = [];
  const push = (key: string, title: string, group: HistoryItem[]) => {
    if (group.length > 0) {
      rows.push({ kind: 'section', key, title: `${title} · ${group.length}` });
      rows.push(...group.map((item): Row => ({ kind: 'relic', key: String(item.pageId), item })));
    }
  };
  push('s-lost', 'Lost', lost);
  push('s-plaques', 'Plaques', plaques);
  push('s-hidden', 'Hidden history', hidden);
  return rows;
}

function Hero({ areaName, article }: { areaName: string; article: Article }) {
  const lead: ArticleImage | undefined = article.images[0];
  return (
    <View style={styles.hero}>
      {lead && (
        <Image source={{ uri: lead.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
      )}
      <View style={[StyleSheet.absoluteFill, styles.heroShade]} />
      {lead && (
        <ThemedText type="small" style={styles.heroCredit} numberOfLines={1}>
          {lead.credit}
        </ThemedText>
      )}
      <View style={styles.heroText}>
        <ThemedText type="eyebrow" style={styles.heroLight}>
          The story of
        </ThemedText>
        <ThemedText type="largeTitle" style={styles.heroLight}>
          {areaName}
        </ThemedText>
        <ThemedText type="small" style={styles.heroDim}>
          {article.minutes} min read · {article.chapters.length} chapters
        </ThemedText>
      </View>
    </View>
  );
}

export function AreaGazetteer({
  areaName,
  relics,
  refreshing,
  onRefresh,
}: {
  areaName: string | null;
  relics: HistoryItem[];
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const insets = useSafeAreaInsets();
  const walkStops = usePlan();
  const [article, setArticle] = useState<Article | null>(null);
  const [articleFor, setArticleFor] = useState<string | null>(null);

  // Adjust-during-render: walking into Deptford must not show Greenwich
  if (articleFor !== areaName) {
    setArticleFor(areaName);
    setArticle(null);
  }

  useEffect(() => {
    if (!areaName) {
      return;
    }
    let active = true;
    (async () => {
      const loaded = await fetchArticle(areaName).catch(() => null);
      if (active) {
        setArticle(loaded);
      }
    })();
    return () => {
      active = false;
    };
  }, [areaName]);

  // The area's own article leads the screen, not the list
  const listRelics = relics.filter(
    (item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase()
  );
  const rows = gazetteerRows(listRelics);
  const intro = article?.chapters.find((chapter) => chapter.title === '')?.paragraphs ?? [];
  const chapters = article?.chapters.filter((chapter) => chapter.title !== '') ?? [];
  // Thread the article's remaining images between every other fold
  const spare = article?.images.slice(1) ?? [];

  return (
    <FlatList
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item: row }) =>
        row.kind === 'section' ? (
          <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.sectionHead}>
            {row.title}
          </ThemedText>
        ) : (
          <View style={styles.cardWrap}>
            <HistoryCard item={row.item} archive />
          </View>
        )
      }
      contentContainerStyle={{
        paddingBottom: Spacing.four + insets.bottom + (walkStops.length > 0 ? 64 : 0),
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      initialNumToRender={8}
      ListHeaderComponent={
        article && areaName ? (
          <View>
            <Hero areaName={areaName} article={article} />
            <View style={styles.article}>
              {intro.map((paragraph, index) => (
                <ThemedText key={index} type="default" style={styles.introPara}>
                  {paragraph}
                </ThemedText>
              ))}
              <ChapterFolds
                chapters={chapters}
                interleave={(index) => {
                  const image = index % 2 === 1 ? spare[(index - 1) / 2] : undefined;
                  return image ? (
                    <View style={styles.inlineWrap}>
                      <Image
                        source={{ uri: image.imageUrl }}
                        style={styles.inlineImage}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      <ThemedText type="small" themeColor="textSecondary" style={styles.inlineCredit} numberOfLines={1}>
                        {image.credit}
                      </ThemedText>
                    </View>
                  ) : null;
                }}
              />
            </View>
          </View>
        ) : null
      }
      ListEmptyComponent={
        article ? null : (
          <ThemedText type="small" themeColor="textSecondary" style={styles.empty}>
            Nothing hidden here that the records know of.
          </ThemedText>
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  hero: {
    height: 220,
    justifyContent: 'flex-end',
    backgroundColor: '#31406B',
  },
  heroShade: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  heroText: {
    padding: Spacing.four,
    gap: 2,
  },
  // White holds on the shaded photo in both modes
  heroLight: {
    color: '#FFFFFF',
  },
  heroDim: {
    color: '#FFFFFF',
    opacity: 0.85,
  },
  heroCredit: {
    position: 'absolute',
    top: Spacing.two,
    right: Spacing.three,
    color: '#FFFFFF',
    opacity: 0.7,
    fontSize: 10,
  },
  article: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  introPara: {
    marginBottom: Spacing.three,
  },
  inlineWrap: {
    marginVertical: Spacing.two,
    gap: 2,
  },
  inlineImage: {
    height: 130,
    borderRadius: Spacing.three - 2,
  },
  inlineCredit: {
    fontSize: 10,
  },
  sectionHead: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  cardWrap: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.three,
  },
  empty: {
    textAlign: 'center',
    paddingTop: Spacing.six,
  },
});
