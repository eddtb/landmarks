import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AreaShortVersion } from '@/components/area-short-version';
import { ChapterFolds } from '@/components/chapter-folds';
import { HistoryCard } from '@/components/history-card';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Article, ArticleImage, fetchArticle } from '@/data/article-client';
import { usePlan } from '@/hooks/use-plan';
import { HistoryItem } from '@/types/history';

/**
 * The Gazetteer: a magazine cover for the place. Hero from the
 * article's lead image, the gallery of its remaining images (together
 * at the top — Edd's call — never merely NEAR an unrelated chapter),
 * the full story as folds, and beneath it one neutral list of what
 * this ground remembers, tagged only by evidence.
 */

type Row =
  | { kind: 'section'; key: string; title: string }
  | { kind: 'relic'; key: string; item: HistoryItem };

/**
 * Pure and unit-tested: ONE neutral list ("simply a history of the
 * greater area" — Edd). No invented buckets: distance order, and each
 * card carries only what the evidence says — a Wikidata fact tag, a
 * Plaque mark, or nothing.
 */
export function gazetteerRows(relics: HistoryItem[]): Row[] {
  if (relics.length === 0) {
    return [];
  }
  return [
    { kind: 'section', key: 's-ground', title: `From this ground · ${relics.length}` },
    ...relics.map((item): Row => ({ kind: 'relic', key: String(item.pageId), item })),
  ];
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
  // The gallery (Edd's call): the article's remaining images together
  // at the top, credited — never merely NEAR an unrelated chapter
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
            {intro.length > 0 && (
              <AreaShortVersion areaName={areaName} extract={intro.join('\n')} />
            )}
            {spare.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
                contentContainerStyle={styles.galleryContent}>
                {spare.map((image, index) => (
                  <View key={index} style={styles.galleryItem}>
                    <Image
                      source={{ uri: image.imageUrl }}
                      style={styles.galleryImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <ThemedText
                      type="small"
                      themeColor="textSecondary"
                      style={styles.galleryCredit}
                      numberOfLines={1}>
                      {image.credit}
                    </ThemedText>
                  </View>
                ))}
              </ScrollView>
            )}
            <View style={styles.article}>
              {intro.map((paragraph, index) => (
                <ThemedText key={index} type="default" style={styles.introPara}>
                  {paragraph}
                </ThemedText>
              ))}
              <ChapterFolds chapters={chapters} />
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
  gallery: {
    marginTop: Spacing.three,
  },
  galleryContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  galleryItem: {
    width: 168,
    gap: 2,
  },
  galleryImage: {
    height: 110,
    borderRadius: Spacing.three - 2,
  },
  galleryCredit: {
    fontSize: 9,
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
