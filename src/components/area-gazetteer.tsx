import { Image } from 'expo-image';
import { router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChapterFolds } from '@/components/chapter-folds';
import { HistoryCard } from '@/components/history-card';
import { ImageViewer } from '@/components/image-viewer';
import { ThemedText } from '@/components/themed-text';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchArticle, fetchArticleLight } from '@/data/article-client';
import { ApiError } from '@/data/cached-get';
import { fetchRetold } from '@/data/retold-client';
import { Article, ArticleChapter, ArticleImage } from '@/types/article';
import { Retold, RetoldPart, TimelineStop } from '@/types/retold';
import { LinkCandidate, linkifyParagraph, planStoryLinks } from '@/utils/linkify';
import { withoutPullQuote } from '@/utils/pull-quote';
import { readingProgress } from '@/utils/reading-progress';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { speakAsync, speechAvailable, stopSpeech, usingEnhancedVoice } from '@/utils/speech';

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

export type RetoldStatus = 'pending' | 'streaming' | 'ready' | 'halted' | 'none';

export type GazetteerRow =
  | { kind: 'ai-label'; key: string }
  | { kind: 'no-story'; key: string }
  | { kind: 'timeline'; key: string; stops: TimelineStop[] }
  | { kind: 'part'; key: string; part: RetoldPart; index: number }
  | { kind: 'retelling-pending'; key: string }
  | { kind: 'retelling-halted'; key: string }
  | { kind: 'fallback-article'; key: string }
  | { kind: 'door'; key: string; open: boolean }
  | { kind: 'original'; key: string }
  | { kind: 'section'; key: string; title: string }
  | { kind: 'relic'; key: string; item: HistoryItem };

/** Pure and unit-tested: the whole scroll as data. */
export function buildGazetteerRows(options: {
  hasArticle: boolean;
  /** Probed and genuinely absent (never while loading): the area has a
   * name, but no article answers to it. */
  storyMissing?: boolean;
  retoldStatus: RetoldStatus;
  retold: Retold | null;
  /** Complete parts landed so far by a live (or halted) stream. */
  streamedParts?: RetoldPart[];
  originalOpen: boolean;
  relics: HistoryItem[];
}): GazetteerRow[] {
  const { hasArticle, storyMissing, retoldStatus, retold, originalOpen, relics } = options;
  const streamedParts = options.streamedParts ?? [];
  const rows: GazetteerRow[] = [];

  if (!hasArticle && storyMissing && relics.length > 0) {
    // The wordless miss gets words: a named area whose article simply
    // doesn't exist must say so — bare relics with no explanation read
    // as broken (device-triaged, pre-cascade Dorking). With no relics
    // either, the list's own empty state already speaks.
    rows.push({ kind: 'no-story', key: 'no-story' });
  }

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
    } else if (retoldStatus === 'streaming' || retoldStatus === 'halted') {
      // A live stream: the label lands with the first part; the story
      // grows part by complete part. No timeline, no door yet — both
      // are end-of-telling business. A halted stream keeps what
      // arrived and offers the rest.
      if (streamedParts.length === 0) {
        rows.push(
          retoldStatus === 'streaming'
            ? { kind: 'retelling-pending', key: 'retelling-pending' }
            : { kind: 'fallback-article', key: 'fallback-article' }
        );
      } else {
        rows.push({ kind: 'ai-label', key: 'ai-label' });
        rows.push(
          ...streamedParts.map(
            (part, index): GazetteerRow => ({ kind: 'part', key: `part-${index}`, part, index })
          )
        );
        rows.push(
          retoldStatus === 'streaming'
            ? { kind: 'retelling-pending', key: 'retelling-pending' }
            : { kind: 'retelling-halted', key: 'retelling-halted' }
        );
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
  const lead: ArticleImage | undefined = (article.images ?? [])[0];
  return (
    <View style={styles.hero} testID="gazetteer-hero">
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
  const [spokeOnce, setSpokeOnce] = useState(false);
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
    setSpokeOnce(true);
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

  return { speaking, engineFailed, spokeOnce, toggle };
}

export function AreaGazetteer({
  areaName,
  areaSettled = true,
  relics,
  allStories,
  refreshing,
  onRefresh,
  lead,
  empty,
}: {
  areaName: string | null;
  /** False while the area-name cascade is still resolving: a null
   * areaName then means "wait", not "nowhere". Once settled, a null
   * name lets the fetch effects declare "none" instead of pending
   * forever (#217's mid-sea spinner). Place screens always pass a
   * name, so the default is settled. */
  areaSettled?: boolean;
  relics: HistoryItem[];
  /** Every story of the ground — the web of history links into all of them. */
  allStories: HistoryItem[];
  refreshing: boolean;
  onRefresh: () => void;
  /** Rendered in the header under the hero — a place screen's Go row. */
  lead?: ReactNode;
  /** Rendered when NO article exists (never while loading) — a place
   * screen's fallback story. Areas keep the default empty text. */
  empty?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // A reanimated shared value: scroll ticks land on the UI thread and
  // the bar's width answers there too — no JS-bridge traffic at all
  const readProgress = useSharedValue(0);
  // The reading bar: recompute on every scroll tick, no re-render —
  // the whole exchange stays on the UI thread
  const onScroll = useAnimatedScrollHandler((event) => {
    readProgress.set(
      readingProgress(event.contentOffset.y, event.contentSize.height, event.layoutMeasurement.height)
    );
  });
  const fillStyle = useAnimatedStyle(() => ({
    width: `${readProgress.get() * 100}%`,
  }));
  // The bar earns its place: the track shows only when the story is
  // taller than the screen — the same "nothing to read, no bar" rule
  // readingProgress enforces for the fill
  const [scrollable, setScrollable] = useState(false);
  const frame = useRef({ content: 0, viewport: 0 });
  const remeasure = () => setScrollable(frame.current.content - frame.current.viewport > 0);
  const listRef = useRef<FlatList<GazetteerRow>>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [articleStatus, setArticleStatus] = useState<'pending' | 'ready' | 'none'>('pending');
  const [retold, setRetold] = useState<Retold | null>(null);
  const [retoldStatus, setRetoldStatus] = useState<RetoldStatus>('pending');
  // A cold generation streams: complete parts land here one by one.
  // The ref mirrors the state so the error path can ask "did anything
  // arrive?" without a stale closure.
  const [streamedParts, setStreamedParts] = useState<RetoldPart[]>([]);
  const streamedRef = useRef<RetoldPart[]>([]);
  const streamedFor = useRef<string | null>(null);
  const [retoldAttempt, setRetoldAttempt] = useState(0);
  const [originalOpen, setOriginalOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [areaFor, setAreaFor] = useState<string | null>(null);
  const { speaking, engineFailed, spokeOnce, toggle } = useRetoldSpeaker(retold);

  // Adjust-during-render: walking into Deptford must not show Greenwich
  if (areaFor !== areaName) {
    setAreaFor(areaName);
    setArticle(null);
    setArticleStatus('pending');
    setRetold(null);
    setRetoldStatus('pending');
    // The ref mirror resets in the fetch effect below — a ref write
    // during render trips the hooks rules, and the effect runs before
    // any new part could land
    setStreamedParts([]);
    setOriginalOpen(false);
  }

  // …and must not inherit its reading progress. An effect, not the
  // adjust block above: writing a shared value during render trips
  // Reanimated's strict mode (verified on the sim), and the reset
  // only needs to land before the next area's story can scroll —
  // its fetches haven't even resolved by the time this runs.
  useEffect(() => {
    readProgress.set(0);
  }, [areaName, readProgress]);

  // Two INDEPENDENT fetches: the hero paints the moment the article
  // lands; the retelling streams in when ready (Edd: "loading too
  // slowly" — the old Promise.all gated everything on the slowest)
  useEffect(() => {
    if (!areaName) {
      return;
    }
    let active = true;
    (async () => {
      // Light first: hero text and reading time paint off the cheap
      // extract leg (~0.2s cold) instead of waiting ~1.2s more for
      // the gallery's image legs. The hero simply renders imageless
      // until the full article replaces it below.
      const light = await fetchArticleLight(areaName).catch(() => null);
      if (active && light) {
        setArticle(light);
        setArticleStatus('ready');
      }
      const loaded = await fetchArticle(areaName).catch(() => null);
      if (!active) {
        return;
      }
      if (loaded) {
        setArticle(loaded);
        setArticleStatus('ready');
      } else if (!light) {
        // Only a double miss is "none" — a painted light article
        // never flashes away because the image leg failed
        setArticleStatus('none');
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
    // A new area starts from nothing; a RETRY of the same area keeps
    // what arrived (the mirror matches the state the adjust block set)
    if (streamedFor.current !== areaName) {
      streamedFor.current = areaName;
      streamedRef.current = [];
    }
    let active = true;
    (async () => {
      try {
        // A server cache hit resolves in one hop; a cold generation
        // streams — each complete part renders the moment it lands
        const loaded = await fetchRetold(areaName, (part, index) => {
          if (!active) {
            return;
          }
          streamedRef.current = [...streamedRef.current.slice(0, index), part];
          setStreamedParts(streamedRef.current);
          setRetoldStatus('streaming');
        });
        if (active) {
          setRetold(loaded);
          setRetoldStatus(loaded ? 'ready' : 'none');
        }
      } catch (error) {
        if (!active) {
          return;
        }
        // A 404 is the server's verdict ("no retelling") — fall back to
        // the original article. Anything else mid-stream keeps what
        // arrived and offers a retry; with nothing arrived, the
        // original article stands, as it always has.
        const verdict = error instanceof ApiError && error.status === 404;
        setRetoldStatus(!verdict && streamedRef.current.length > 0 ? 'halted' : 'none');
      }
    })();
    return () => {
      active = false;
    };
  }, [areaName, retoldAttempt]);

  // #217: settled on NO name at all (mid-sea) — the fetch effects
  // above never run, so no status would ever leave 'pending' by
  // itself. Derived, not set: the moment a name appears, the real
  // statuses lead again.
  const areaMissing = areaName === null && areaSettled;
  const resolvedArticleStatus = areaMissing ? 'none' : articleStatus;
  const resolvedRetoldStatus = areaMissing ? 'none' : retoldStatus;

  // The area's own article leads the screen, not the list
  const listRelics = relics.filter(
    (item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase()
  );
  const rows = buildGazetteerRows({
    hasArticle: article !== null,
    storyMissing: resolvedArticleStatus === 'none' && areaName !== null,
    retoldStatus: resolvedRetoldStatus,
    retold,
    streamedParts,
    originalOpen,
    relics: listRelics,
  });

  const linkCandidates: LinkCandidate[] = allStories
    .filter((item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase())
    .map((item) => ({ title: item.title, pageId: item.pageId }));

  // The parts on screen: the finished telling once ready, the live
  // stream's complete parts while it writes (or stands halted)
  const partsShown = resolvedRetoldStatus === 'ready' && retold ? retold.parts : streamedParts;

  // Story-level, once: the pull-quote excision and the link plan
  // (first mention per STORY — a repeated name is prose, not a door)
  const partParagraphs = partsShown.map((part) =>
    withoutPullQuote(part.body.split(/\n+/).filter(Boolean), part.pullQuote)
  );
  const linkPlan = planStoryLinks(partParagraphs, linkCandidates);

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
      case 'no-story':
        // Honest, in the house voice — where the hero would have stood
        return (
          <ThemedText type="small" themeColor="textSecondary" style={styles.noStory}>
            No recorded story for this area yet — its relics are below.
          </ThemedText>
        );
      case 'ai-label':
        return (
          <View>
          <View style={styles.aiLabel}>
            <ThemedText type="small" themeColor="textSecondary" style={styles.aiLabelText}>
              ✦ Retold by AI from Wikipedia — original below
            </ThemedText>
            {speechAvailable && retold && (
              <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.two}>
                <ThemedText type="smallBold" themeColor="accent">
                  {speaking ? '◼ Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
                </ThemedText>
              </Pressable>
            )}
          </View>
          {spokeOnce && !speaking && !usingEnhancedVoice() && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.voiceHint}>
              A nicer voice is one download away: Settings › Accessibility › Spoken Content ›
              Voices › English (UK)
            </ThemedText>
          )}
          </View>
        );
      case 'timeline':
        return <TimelineStrip stops={row.stops} onStop={jumpToPart} />;
      case 'part':
        return (
          <PartRow
            part={row.part}
            index={row.index}
            paragraphs={partParagraphs[row.index] ?? []}
            paragraphLinks={linkPlan[row.index] ?? []}
          />
        );
      case 'retelling-pending':
        return (
          <ThemedText type="small" themeColor="textSecondary" style={styles.pending}>
            ✦ Retelling this place…
          </ThemedText>
        );
      case 'retelling-halted':
        // The stream broke: honest words, and the offer to finish —
        // a re-ask restarts the whole generation (still one call site)
        return (
          <View style={styles.halted}>
            <ThemedText type="small" themeColor="textSecondary">
              The retelling stopped partway.
            </ThemedText>
            <Pressable
              accessibilityRole="button"
              testID="retell-retry"
              onPress={() => {
                setRetoldStatus('streaming');
                setRetoldAttempt((attempt) => attempt + 1);
              }}
              hitSlop={Spacing.two}>
              <ThemedText type="smallBold" themeColor="accent">
                Retell the rest
              </ThemedText>
            </Pressable>
          </View>
        );
      case 'fallback-article':
        // No retelling earned this place (a short article, under the
        // MinSourceChars gate): the original stands AS the story. It
        // must say so — an unlabelled article body under the hero reads
        // as a retelling that failed to load (device-triaged: the
        // Spanish Galleon). The eyebrow mirrors the retold banner's
        // frame so a stub screen looks deliberate, not broken.
        return <ArticleBody intro={intro} chapters={chapters} label="From Wikipedia" />;
      case 'original':
        // The original behind the door: the door itself already labels
        // it, so no eyebrow here.
        return <ArticleBody intro={intro} chapters={chapters} />;
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
    <View style={styles.wrap}>
    <Animated.FlatList
      ref={listRef}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item: row }) => renderRow(row)}
      onScroll={onScroll}
      // 16, not 32: the events no longer cross the bridge, so every
      // frame can feed the bar for free
      scrollEventThrottle={16}
      onContentSizeChange={(_, height) => {
        frame.current.content = height;
        remeasure();
      }}
      onLayout={(event) => {
        frame.current.viewport = event.nativeEvent.layout.height;
        remeasure();
      }}
      contentContainerStyle={{
        paddingBottom: Spacing.four + insets.bottom,
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
              onPress={() => (article.images ?? []).length > 0 && setViewerIndex(0)}>
              <Hero areaName={areaName} article={article} retold={retold} />
            </Pressable>
            {(article.images ?? []).length > 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.gallery}
                contentContainerStyle={styles.galleryContent}>
                {(article.images ?? []).slice(1).map((image, index) => (
                  <Pressable
                    key={index}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="Open photo"
                    testID="gallery-photo"
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
            {lead}
          </View>
        ) : lead ? (
          <View>{lead}</View>
        ) : null
      }
      ListEmptyComponent={
        article ? null : resolvedArticleStatus === 'pending' ? (
          <ActivityIndicator style={styles.empty} />
        ) : empty ? (
          <>{empty}</>
        ) : (
          // Mock 1: the History-tab empty gets the same quiet accent
          // wander line as the feed's — static, above the words
          <View style={styles.empty}>
            <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
              Nothing hidden here that the records know of.
            </ThemedText>
          </View>
        )
      }
    />
    {/* The violet reading bar (Edd's ask, returned): how far through
        the story you are, riding the top edge of the scroll. The soft
        track is the fix for "hasn't been built": a bare fill is zero
        pixels before you scroll, and violet alone vanished into the
        hero's shade — the track says the bar exists from the start */}
    {scrollable && (
      <View
        pointerEvents="none"
        style={[styles.progressTrack, { backgroundColor: theme.accentSoft }]}
        testID="reading-progress">
        <Animated.View
          style={[styles.progressFill, { backgroundColor: theme.accent }, fillStyle]}
        />
      </View>
    )}
    <ImageViewer
      images={article?.images ?? []}
      initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)}
    />
    </View>
  );
}

/**
 * The Wikipedia article as the story body — shared by the two rows
 * that show it: the `fallback-article` (no retelling, so the original
 * stands as the story, labelled) and the `original` behind the door
 * (already labelled by the door, so no eyebrow).
 */
function ArticleBody({
  intro,
  chapters,
  label,
}: {
  intro: string[];
  chapters: ArticleChapter[];
  label?: string;
}) {
  return (
    <View style={styles.article}>
      {label && (
        <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.articleLabel}>
          {label}
        </ThemedText>
      )}
      {intro.map((paragraph, index) => (
        <ThemedText key={index} type="default" style={styles.para}>
          {paragraph}
        </ThemedText>
      ))}
      <ChapterFolds chapters={chapters} />
    </View>
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
          testID="timeline-stop"
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

function PartRow({
  part,
  index,
  paragraphs,
  paragraphLinks,
}: {
  part: RetoldPart;
  index: number;
  /** Pull-quote already excised; computed once at story level. */
  paragraphs: string[];
  /** The story-level link plan for this part: first mentions only. */
  paragraphLinks: LinkCandidate[][];
}) {
  const theme = useTheme();
  const quoteAfter = part.pullQuote ? Math.ceil(paragraphs.length / 2) - 1 : -1;
  return (
    <View style={styles.partWrap}>
      {index > 0 && <View style={[styles.rule, { backgroundColor: theme.backgroundElement }]} />}
      {/* Grey, not violet: labels aren't tappable, and violet must
          keep meaning "tappable" (the theme's own no-third-case rule) */}
      <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.partNum} testID="part-eyebrow">
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
            {linkifyParagraph(paragraph, paragraphLinks[paragraphIndex] ?? []).map((segment, segmentIndex) =>
              segment.pageId !== undefined ? (
                <ThemedText
                  key={segmentIndex}
                  type="default"
                  themeColor="accent"
                  onPress={() =>
                    router.push({
                      pathname: '/history/[pageId]',
                      params: { pageId: String(segment.pageId) },
                    })
                  }>
                  {segment.text}
                </ThemedText>
              ) : (
                segment.text
              )
            )}
          </ThemedText>
          {paragraphIndex === quoteAfter && (
            <View style={[styles.pull, { borderLeftColor: theme.accent }]}>
              {/* The accent border is the flourish; the words stay ink —
                  violet text is reserved for things a finger can press */}
              <ThemedText type="headline" style={styles.pullText}>
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
  wrap: {
    flex: 1,
  },
  // 4px, not 3: thick enough to register at a glance, thin enough to
  // stay a bar and not a banner
  progressTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  progressFill: {
    height: 4,
  },
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
  noStory: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
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
  voiceHint: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.one,
    fontSize: 11,
  },
  pending: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  halted: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  article: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
  articleLabel: {
    marginBottom: Spacing.three,
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
    alignItems: 'center',
    paddingTop: Spacing.six,
    gap: Spacing.three,
  },
  emptyCopy: {
    textAlign: 'center',
  },
});
