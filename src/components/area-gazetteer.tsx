import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChapterFolds } from '@/components/chapter-folds';
import { HistoryCard } from '@/components/history-card';
import { ImageViewer } from '@/components/image-viewer';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { Article, ArticleImage, fetchArticle } from '@/data/article-client';
import { fetchRetold, Retold, RetoldPart, TimelineStop } from '@/data/retold-client';
import { usePlan } from '@/hooks/use-plan';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { speakAsync, speechAvailable, stopSpeech } from '@/utils/speech';

/**
 * The Gazetteer: a magazine cover for the place. Hero and gallery in
 * the header; EVERYTHING ELSE IS A ROW — the retold parts, the door,
 * the original, the relics — so the story virtualises (the hero
 * paints the moment the article lands; the retelling streams in when
 * ready) and a tapped timeline year can scroll straight to the part
 * that tells it (Edd's ask).
 */

const PartWords = [
  'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

export type RetoldStatus = 'pending' | 'ready' | 'none';

export type GazetteerRow =
  | { kind: 'ai-label'; key: string }
  | { kind: 'timeline'; key: string; stops: TimelineStop[] }
  | { kind: 'part'; key: string; part: RetoldPart; index: number }
  | { kind: 'retelling-pending'; key: string }
  | { kind: 'fallback-article'; key: string }
  | { kind: 'door'; key: string; open: boolean }
  | { kind: 'original'; key: string }
  | { kind: 'section'; key: string; title: string }
  | { kind: 'relic'; key: string; item: HistoryItem };

/** Pure and unit-tested: the whole scroll as data. */
export function buildGazetteerRows(options: {
  hasArticle: boolean;
  retoldStatus: RetoldStatus;
  retold: Retold | null;
  originalOpen: boolean;
  relics: HistoryItem[];
}): GazetteerRow[] {
  const { hasArticle, retoldStatus, retold, originalOpen, relics } = options;
  const rows: GazetteerRow[] = [];

  if (hasArticle) {
    if (retoldStatus === 'ready' && retold) {
      rows.push({ kind: 'ai-label', key: 'ai-label' });
      if ((retold.timeline ?? []).length > 0) {
        rows.push({ kind: 'timeline', key: 'timeline', stops: retold.timeline });
      }
      rows.push(
        ...retold.parts.map(
          (part, index): GazetteerRow => ({ kind: 'part', key: `part-${index}`, part, index })
        )
      );
      rows.push({ kind: 'door', key: 'door', open: originalOpen });
      if (originalOpen) {
        rows.push({ kind: 'original', key: 'original' });
      }
    } else if (retoldStatus === 'pending') {
      rows.push({ kind: 'retelling-pending', key: 'retelling-pending' });
    } else {
      // No retelling exists: the original article stands as the story
      rows.push({ kind: 'fallback-article', key: 'fallback-article' });
    }
  }

  if (relics.length > 0) {
    rows.push({ kind: 'section', key: 's-ground', title: `From this ground · ${relics.length}` });
    rows.push(
      ...relics.map((item): GazetteerRow => ({ kind: 'relic', key: String(item.pageId), item }))
    );
  }
  return rows;
}

/** Where a timeline stop's part lives in the rows, or -1. */
export function partRowIndex(rows: GazetteerRow[], partNumber: number): number {
  return rows.findIndex((row) => row.kind === 'part' && row.index === partNumber - 1);
}

function Hero({
  areaName,
  article,
  retold,
}: {
  areaName: string;
  article: Article;
  retold: Retold | null;
}) {
  const lead: ArticleImage | undefined = article.images[0];
  return (
    <View style={styles.hero}>
      {lead && (
        <Image
          source={{ uri: lead.imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
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
          {retold
            ? `${retold.parts.length} parts · about ${retold.minutes} min · retold from Wikipedia`
            : `${article.minutes} min read · ${article.chapters.length} chapters`}
        </ThemedText>
      </View>
    </View>
  );
}

function useRetoldSpeaker(retold: Retold | null) {
  const [speaking, setSpeaking] = useState(false);
  const [engineFailed, setEngineFailed] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
      void stopSpeech();
    };
  }, []);

  const toggle = async () => {
    if (speaking) {
      cancelled.current = true;
      await stopSpeech();
      setSpeaking(false);
      return;
    }
    if (!retold) {
      return;
    }
    cancelled.current = false;
    setEngineFailed(false);
    setSpeaking(true);
    for (const [index, part] of retold.parts.entries()) {
      if (cancelled.current) {
        return;
      }
      const outcome = await speakAsync(`Part ${index + 1}: ${part.heading}.`);
      if (outcome === 'error') {
        // A broken engine must say so, not mime success
        setEngineFailed(true);
        setSpeaking(false);
        return;
      }
      if (cancelled.current) {
        return;
      }
      await speakAsync(part.body);
    }
    if (!cancelled.current) {
      setSpeaking(false);
    }
  };

  return { speaking, engineFailed, toggle };
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
  const listRef = useRef<FlatList<GazetteerRow>>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [retold, setRetold] = useState<Retold | null>(null);
  const [retoldStatus, setRetoldStatus] = useState<RetoldStatus>('pending');
  const [originalOpen, setOriginalOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [areaFor, setAreaFor] = useState<string | null>(null);
  const { speaking, engineFailed, toggle } = useRetoldSpeaker(retold);

  // Adjust-during-render: walking into Deptford must not show Greenwich
  if (areaFor !== areaName) {
    setAreaFor(areaName);
    setArticle(null);
    setRetold(null);
    setRetoldStatus('pending');
    setOriginalOpen(false);
  }

  // Two INDEPENDENT fetches: the hero paints the moment the article
  // lands; the retelling streams in when ready (Edd: "loading too
  // slowly" — the old Promise.all gated everything on the slowest)
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

  useEffect(() => {
    if (!areaName) {
      return;
    }
    let active = true;
    (async () => {
      const loaded = await fetchRetold(areaName).catch(() => null);
      if (active) {
        setRetold(loaded);
        setRetoldStatus(loaded ? 'ready' : 'none');
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
  const rows = buildGazetteerRows({
    hasArticle: article !== null,
    retoldStatus,
    retold,
    originalOpen,
    relics: listRelics,
  });

  const jumpToPart = (stop: TimelineStop) => {
    const index = partRowIndex(rows, stop.part);
    if (index >= 0) {
      listRef.current?.scrollToIndex({ index, viewPosition: 0, viewOffset: 8 });
    }
  };

  const intro = article?.chapters.find((chapter) => chapter.title === '')?.paragraphs ?? [];
  const chapters = article?.chapters.filter((chapter) => chapter.title !== '') ?? [];

  const renderRow = (row: GazetteerRow) => {
    switch (row.kind) {
      case 'ai-label':
        return (
          <View style={styles.aiLabel}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.aiLabelText}>
              ✦ Retold by AI from Wikipedia — original below
            </ThemedText>
            {speechAvailable && (
              <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.two}>
                <ThemedText type="smallBold" themeColor="accent">
                  {speaking ? '◼ Stop' : engineFailed ? '🔊 Speech failed · retry' : '🔊 Listen'}
                </ThemedText>
              </Pressable>
            )}
          </View>
        );
      case 'timeline':
        return <TimelineStrip stops={row.stops} onStop={jumpToPart} />;
      case 'part':
        return <PartRow part={row.part} index={row.index} />;
      case 'retelling-pending':
        return (
          <ThemedText type="small" themeColor="textSecondary" style={styles.pending}>
            ✦ Retelling this place…
          </ThemedText>
        );
      case 'fallback-article':
      case 'original':
        return (
          <View style={styles.article}>
            {intro.map((paragraph, index) => (
              <ThemedText key={index} type="default" style={styles.para}>
                {paragraph}
              </ThemedText>
            ))}
            <ChapterFolds chapters={chapters} />
          </View>
        );
      case 'door':
        return (
          <DoorRow open={row.open} minutes={article?.minutes ?? 0} onToggle={() => setOriginalOpen((open) => !open)} />
        );
      case 'section':
        return (
          <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.sectionHead}>
            {row.title}
          </ThemedText>
        );
      case 'relic':
        return (
          <View style={styles.cardWrap}>
            <HistoryCard item={row.item} archive />
          </View>
        );
    }
  };

  return (
    <>
    <FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item: row }) => renderRow(row)}
      contentContainerStyle={{
        paddingBottom: Spacing.four + insets.bottom + (walkStops.length > 0 ? 64 : 0),
      }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      showsVerticalScrollIndicator={false}
      initialNumToRender={6}
      onScrollToIndexFailed={({ index, averageItemLength }) => {
        // Variable row heights: land nearby, then settle exactly
        listRef.current?.scrollToOffset({ offset: index * averageItemLength });
        setTimeout(
          () => listRef.current?.scrollToIndex({ index, viewPosition: 0, viewOffset: 8 }),
          250
        );
      }}
      ListHeaderComponent={
        article && areaName ? (
          <View>
            <Pressable
              accessibilityRole="imagebutton"
              accessibilityLabel="Open the cover photo"
              onPress={() => article.images.length > 0 && setViewerIndex(0)}>
              <Hero areaName={areaName} article={article} retold={retold} />
            </Pressable>
            {article.images.length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
                contentContainerStyle={styles.galleryContent}>
                {article.images.slice(1).map((image, index) => (
                  <Pressable
                    key={index}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open photo"
                    onPress={() => setViewerIndex(index + 1)}
                    style={({ pressed }) => [styles.galleryItem, pressed && { opacity: 0.85 }]}>
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
                  </Pressable>
                ))}
              </ScrollView>
            )}
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
    <ImageViewer
      images={article?.images ?? []}
      initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)}
    />
    </>
  );
}

function TimelineStrip({
  stops,
  onStop,
}: {
  stops: TimelineStop[];
  onStop: (stop: TimelineStop) => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.timeline}
      contentContainerStyle={styles.timelineContent}>
      {stops.map((stop, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`${stop.year}: ${stop.label} — read part ${stop.part}`}
          onPress={() => onStop(stop)}
          style={({ pressed }) => [
            styles.timelineStop,
            { backgroundColor: theme.accentSoft },
            pressed && { opacity: 0.8 },
          ]}>
          <ThemedText type="smallBold" themeColor="accent" style={styles.timelineYear}>
            {stop.year}
          </ThemedText>
          <ThemedText type="small" style={styles.timelineLabel} numberOfLines={2}>
            {stop.label}
          </ThemedText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function PartRow({ part, index }: { part: RetoldPart; index: number }) {
  const theme = useTheme();
  const paragraphs = part.body.split(/\n+/).filter(Boolean);
  const quoteAfter = part.pullQuote ? Math.ceil(paragraphs.length / 2) - 1 : -1;
  return (
    <View style={styles.partWrap}>
      {index > 0 && <View style={[styles.rule, { backgroundColor: theme.backgroundElement }]} />}
      <ThemedText type="eyebrow" themeColor="accent" style={styles.partNum}>
        Part {PartWords[index] ?? index + 1}
      </ThemedText>
      <ThemedText type="headline" style={styles.partHead}>
        {part.heading}
      </ThemedText>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <View key={paragraphIndex}>
          <ThemedText
            type="default"
            style={[styles.para, index === 0 && paragraphIndex === 0 && styles.lede]}>
            {paragraph}
          </ThemedText>
          {paragraphIndex === quoteAfter && (
            <View style={[styles.pull, { borderLeftColor: theme.accent }]}>
              <ThemedText type="headline" themeColor="accent" style={styles.pullText}>
                {part.pullQuote}
              </ThemedText>
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

function DoorRow({
  open,
  minutes,
  onToggle,
}: {
  open: boolean;
  minutes: number;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onToggle}
      style={({ pressed }) => [
        styles.door,
        { backgroundColor: theme.accentSoft },
        pressed && { opacity: 0.85 },
      ]}>
      <ThemedText type="smallBold" themeColor="accent">
        {open ? 'Hide the original article ⌄' : 'Read the original article ›'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Wikipedia · {minutes} min
      </ThemedText>
    </Pressable>
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
  pending: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  article: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  partWrap: {
    paddingHorizontal: Spacing.four,
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
  lede: {
    fontSize: 17.5,
    lineHeight: 27,
    fontWeight: '500',
  },
  pull: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: 2,
    marginBottom: Spacing.three,
  },
  pullText: {
    fontSize: 18,
    lineHeight: 25,
  },
  timeline: {
    marginTop: Spacing.two,
    // A breath between the fun facts and PART ONE (Edd's redline)
    marginBottom: Spacing.four,
  },
  timelineContent: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  timelineStop: {
    borderRadius: Spacing.three - 2,
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    maxWidth: 150,
  },
  timelineYear: {
    fontSize: 15,
  },
  timelineLabel: {
    fontSize: 11,
    lineHeight: 14,
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
