import { Image } from 'expo-image';
import { router } from 'expo-router';
import { memo, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ListRenderItemInfo,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import { HistoryCard } from '@/components/history-card';
import { ImageViewer } from '@/components/image-viewer';
import { TellingLead } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchArticle, fetchArticleLight } from '@/data/article-client';
import { ApiError } from '@/data/cached-get';
import { fetchRetold } from '@/data/retold-client';
import { Article, ArticleImage } from '@/types/article';
import { Retold, RetoldPart, TimelineStop } from '@/types/retold';
import { stripEmphasis } from '@/utils/format';
import { LinkCandidate, linkifyParagraph, planStoryLinks } from '@/utils/linkify';
import { withoutPullQuote } from '@/utils/pull-quote';
import { readingProgress } from '@/utils/reading-progress';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { speakAsync, speechAvailable, stopSpeech, usingEnhancedVoice } from '@/utils/speech';

/**
 * The Gazetteer: a magazine cover for the place. Hero and gallery in
 * the header; EVERYTHING ELSE IS A ROW — the retold parts, the link
 * out to the source, the relics — so the story virtualises (the hero
 * paints the moment the article lands; the retelling streams in when
 * ready) and a tapped timeline year can scroll straight to the part
 * that tells it (Edd's ask).
 */

const PartWords = [
  'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

export type RetoldStatus = 'pending' | 'streaming' | 'ready' | 'halted' | 'none';

// Module-level: a stable identity, so the FlatList never sees a new
// extractor and its rows can honour their memoization
const keyExtractor = (row: GazetteerRow) => row.key;

export type GazetteerRow =
  | { kind: 'ai-label'; key: string }
  | { kind: 'no-story'; key: string }
  | { kind: 'timeline'; key: string; stops: TimelineStop[] }
  | { kind: 'part'; key: string; part: RetoldPart; index: number }
  | { kind: 'retelling-pending'; key: string }
  | { kind: 'retelling-halted'; key: string }
  | { kind: 'telling-lead'; key: string }
  | { kind: 'source-link'; key: string }
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
  relics: HistoryItem[];
  /** A place screen with a telling to hand: wherever the original
   * article would stand alone as the story, the telling opens it. */
  tellingLead?: boolean;
}): GazetteerRow[] {
  const { hasArticle, storyMissing, retoldStatus, retold, relics } = options;
  const streamedParts = options.streamedParts ?? [];
  const rows: GazetteerRow[] = [];

  /**
   * No retelling earned this place. Venture's own telling stands as the
   * story and the source is cited — the SAME shape the retold path has
   * always used ("no inline door, no second copy of the article").
   *
   * It used to render the whole original article here instead, in full,
   * under a "From Wikipedia" eyebrow. Measured on the twenty nearest
   * Greenwich places, ELEVEN fell under retold.ts's 3,000-character gate
   * — so on the majority of screens, and on exactly the small local
   * things that are nearest you (a statue, a memorial, a pub), the app
   * republished a Wikipedia article verbatim beside two links to
   * Wikipedia. App Review's words for this were "only includes links,
   * images, or content aggregated from the Internet", cited three times,
   * and read against that screen the sentence was simply accurate. No
   * widget or geofence was ever going to outweigh an exhibit still on
   * display.
   */
  const pushOwnStory = () => {
    if (options.tellingLead) {
      rows.push({ kind: 'telling-lead', key: 'telling-lead' });
    }
    rows.push({ kind: 'source-link', key: 'source-link' });
  };

  if (!hasArticle && storyMissing && relics.length > 0) {
    // The wordless miss gets words: a named area whose article simply
    // doesn't exist must say so — bare relics with no explanation read
    // as broken (device-triaged, pre-cascade Dorking). With no relics
    // either, the list's own empty state already speaks.
    rows.push({ kind: 'no-story', key: 'no-story' });
  }

  if (hasArticle) {
    if (retoldStatus === 'ready' && retold) {
      if ((retold.timeline ?? []).length > 0) {
        rows.push({ kind: 'timeline', key: 'timeline', stops: retold.timeline });
      }
      rows.push(
        ...retold.parts.map(
          (part, index): GazetteerRow => ({ kind: 'part', key: `part-${index}`, part, index })
        )
      );
      // The byline, then the citation. The label led the whole screen
      // until now, so the first line of every retold place announced the
      // story as AI output over a web page — which is the reviewer's
      // conclusion, volunteered. Under the piece it is the same
      // disclosure doing the same job, in the place a byline goes.
      // (While a retelling is still STREAMING it stays at the top: there
      // it is news rather than attribution — the story is being written
      // for you as you watch.)
      rows.push({ kind: 'ai-label', key: 'ai-label' });
      rows.push({ kind: 'source-link', key: 'source-link' });
    } else if (retoldStatus === 'streaming' || retoldStatus === 'halted') {
      // A live stream: the label lands with the first part; the story
      // grows part by complete part. No timeline, no link out yet —
      // both are end-of-telling business. A halted stream keeps what
      // arrived and offers the rest.
      if (streamedParts.length === 0) {
        if (retoldStatus === 'streaming') {
          rows.push({ kind: 'retelling-pending', key: 'retelling-pending' });
        } else {
          pushOwnStory();
        }
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
      // No retelling exists: our telling is the story, the source is cited
      pushOwnStory();
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
        <ThemedText type="small" style={styles.heroCredit} numberOfLines={1} maxFontSizeMultiplier={1.4}>
          {lead.credit}
        </ThemedText>
      )}
      {/* A fixed 220pt frame: the `small` lines cap like the chrome
          types already do, so accessibility sizes can't overflow it */}
      <View style={styles.heroText}>
        <ThemedText type="eyebrow" style={styles.heroLight}>
          The story of
        </ThemedText>
        <ThemedText type="largeTitle" style={styles.heroLight}>
          {areaName}
        </ThemedText>
        <ThemedText type="small" style={styles.heroDim} maxFontSizeMultiplier={1.4}>
          {retold
            ? `${retold.parts.length} parts · about ${retold.minutes} min · retold from Wikipedia`
            : // No retelling (yet): the body below is the telling, about a
              // minute — the article's own minutes and chapter count
              // described a body the screen no longer shows, and "1
              // chapters" was wrong twice over (caught on the simulator)
              'about a minute'}
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

  // Stable while nothing it reads changes — renderItem depends on it,
  // and a new toggle every render would defeat the row memoization
  const toggle = useCallback(async () => {
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
  }, [speaking, retold]);

  return { speaking, engineFailed, spokeOnce, toggle };
}

export function AreaGazetteer({
  areaName,
  areaLabel,
  areaSettled = true,
  relics,
  allStories,
  refreshing,
  onRefresh,
  lead,
  empty,
  sourceUrl,
  tellingItem,
  onReadThreshold,
}: {
  /** The ARTICLE TITLE — every fetch and filter below keys off it. */
  areaName: string | null;
  /** The same place spoken plainly, for the hero only ("Crystal
   * Palace" where areaName is "Crystal Palace, London"). Place screens
   * pass no label; the title is already how they name themselves. */
  areaLabel?: string | null;
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
  /** The original article's URL. When an unretold place shows the
   * article in full, this adds a "Read more on Wikipedia" link out to
   * the source (Wikipedia has more than we parse — the reference
   * apparatus, every image). Areas don't carry one, so it's optional;
   * the retold screen's link derives one from the area name instead. */
  sourceUrl?: string;
  /** When a place has a story to tell (its own extract, no separate
   * subject), the fallback article gets a telling lead: the AI-told
   * opening above the original, with Listen. Areas pass none. */
  tellingItem?: HistoryItem;
  /** Fired ONCE per story when the reading bar passes ~60% — the
   * journal's definition of "read" (an open is not a read). Place
   * screens pass the journal mark; areas pass none. */
  onReadThreshold?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  // A reanimated shared value: scroll ticks land on the UI thread and
  // the bar's width answers there too — no JS-bridge traffic at all
  const readProgress = useSharedValue(0);
  // "Read" is the bar passing the threshold, once — the crossing is
  // detected here on the UI thread and pays a single JS hop, ever
  const ReadThreshold = 0.6;
  const readMarked = useSharedValue(false);
  // The reading bar: recompute on every scroll tick, no re-render —
  // the whole exchange stays on the UI thread
  const onScroll = useAnimatedScrollHandler((event) => {
    const progress = readingProgress(
      event.contentOffset.y,
      event.contentSize.height,
      event.layoutMeasurement.height
    );
    readProgress.set(progress);
    if (onReadThreshold && progress >= ReadThreshold && !readMarked.get()) {
      readMarked.set(true);
      runOnJS(onReadThreshold)();
    }
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
  }

  // …and must not inherit its reading progress. An effect, not the
  // adjust block above: writing a shared value during render trips
  // Reanimated's strict mode (verified on the sim), and the reset
  // only needs to land before the next area's story can scroll —
  // its fetches haven't even resolved by the time this runs.
  useEffect(() => {
    readProgress.set(0);
    readMarked.set(false);
  }, [areaName, readProgress, readMarked]);

  // Two INDEPENDENT fetches: the hero paints the moment the article
  // lands; the retelling streams in when ready (Edd: "loading too
  // slowly" — the old Promise.all gated everything on the slowest)
  useEffect(() => {
    if (!areaName) {
      return;
    }
    let active = true;
    (async () => {
      // Both asks fly at once (the server folds their shared chapters
      // leg into one call): the light answer paints the hero off the
      // cheap extract leg, the full one replaces it when the gallery
      // legs land — and a late light result may never overwrite it.
      let fullLanded = false;
      const fullAsk = fetchArticle(areaName)
        .catch(() => null)
        .then((loaded) => {
          if (active && loaded) {
            fullLanded = true;
            setArticle(loaded);
            setArticleStatus('ready');
          }
          return loaded;
        });
      const light = await fetchArticleLight(areaName).catch(() => null);
      if (active && light && !fullLanded) {
        setArticle(light);
        setArticleStatus('ready');
      }
      const loaded = await fullAsk;
      if (active && !loaded && !light) {
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

  // Memoized from here down: renderItem's inputs must hold their
  // identity across unrelated re-renders (scroll, speech, the image
  // viewer) or every visible row pays for them
  // The area's own article leads the screen, not the list
  const listRelics = useMemo(
    () => relics.filter((item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase()),
    [relics, areaName]
  );
  const rows = useMemo(
    () =>
      buildGazetteerRows({
        hasArticle: article !== null,
        storyMissing: resolvedArticleStatus === 'none' && areaName !== null,
        retoldStatus: resolvedRetoldStatus,
        retold,
        streamedParts,
        relics: listRelics,
        tellingLead: tellingItem !== undefined,
      }),
    [article, resolvedArticleStatus, areaName, resolvedRetoldStatus, retold, streamedParts, listRelics, tellingItem]
  );

  const linkCandidates: LinkCandidate[] = useMemo(
    () =>
      allStories
        .filter((item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase())
        .map((item) => ({ title: item.title, pageId: item.pageId })),
    [allStories, areaName]
  );

  // The parts on screen: the finished telling once ready, the live
  // stream's complete parts while it writes (or stands halted)
  const partsShown = useMemo(
    () => (resolvedRetoldStatus === 'ready' && retold ? retold.parts : streamedParts),
    [resolvedRetoldStatus, retold, streamedParts]
  );

  // Story-level, once: the pull-quote excision and the link plan
  // (first mention per STORY — a repeated name is prose, not a door)
  const partParagraphs = useMemo(
    () =>
      partsShown.map((part) =>
        // stripEmphasis display-time: cached retellings carry the odd
        // *italicised title* and the renderer is Text, not markdown
        withoutPullQuote(part.body.split(/\n+/).filter(Boolean), part.pullQuote).map(stripEmphasis)
      ),
    [partsShown]
  );
  const linkPlan = useMemo(
    () => planStoryLinks(partParagraphs, linkCandidates),
    [partParagraphs, linkCandidates]
  );

  const jumpToPart = useCallback(
    (stop: TimelineStop) => {
      const index = partRowIndex(rows, stop.part);
      if (index >= 0) {
        listRef.current?.scrollToIndex({ index, viewPosition: 0, viewOffset: 8 });
      }
    },
    [rows]
  );

  // Where "Read more on Wikipedia" points: places pass the item's own
  // URL; areas fetch their article by name alone, so the link derives
  // from the title (Wikipedia resolves spacing and redirects itself).
  const articleUrl =
    sourceUrl ??
    (areaName
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(areaName.replace(/ /g, '_'))}`
      : undefined);

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<GazetteerRow>) => {
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
            {/* Words, not glyphs (PR #186): no ✦ for VoiceOver to call
                "four-pointed star", and Stop is a word — it's violet,
                and violet already means tappable */}
            <ThemedText type="small" themeColor="textSecondary" style={styles.aiLabelText}>
              Retold by AI from Wikipedia — source below
            </ThemedText>
            {speechAvailable && retold && (
              // 16pt slop on the 20px label clears the 44pt target
              <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.three}>
                <ThemedText type="smallBold" themeColor="accent">
                  {speaking ? 'Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
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
            Retelling this place…
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
      case 'telling-lead':
        return tellingItem ? <TellingLead item={tellingItem} /> : null;
      case 'source-link':
        // The telling read, the source one tap away — in the browser,
        // not behind an inline door (Edd's ruling)
        return articleUrl ? <WikipediaLinkRow href={articleUrl} standalone /> : null;
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
    },
    [
      speaking,
      engineFailed,
      spokeOnce,
      toggle,
      retold,
      jumpToPart,
      partParagraphs,
      linkPlan,
      tellingItem,
      articleUrl,
    ]
  );

  return (
    <View style={styles.wrap}>
    <Animated.FlatList
      ref={listRef}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
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
              <Hero areaName={areaLabel ?? areaName} article={article} retold={retold} />
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


/** The one way out to the source, wherever it stands: opens the Wikipedia
 * page in the browser. `standalone` carries its own side margins for
 * use as a bare list row (inside ArticleBody the article pads it). */
function WikipediaLinkRow({ href, standalone }: { href: string; standalone?: boolean }) {
  const theme = useTheme();
  return (
    // asChild, because ExternalLink renders expo-router's Link, which
    // is a TEXT on native: flexDirection, justifyContent and gap were
    // silently doing nothing and the two labels ran together as one
    // inline run ("Read more on Wikipedia ›Wikipedia · source"). A
    // Pressable child lays out as intended and keeps the tap.
    <ExternalLink href={href as `https://${string}`} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Read more on Wikipedia"
        testID="wikipedia-link"
        // Flattened: expo-router's Slot warns on style arrays reaching
        // an asChild child, and the warning is a real one — it cannot
        // merge them for you
        style={StyleSheet.flatten([
          styles.linkRow,
          standalone ? styles.linkRowStandalone : styles.sourceLink,
          { backgroundColor: theme.accentSoft },
        ])}>
        {/* ONE label, and it reads as attribution rather than an
            invitation. It used to be two ("Read more on Wikipedia ›" over
            "Wikipedia · source") on a screen whose meta line already
            named the source — three mentions of Wikipedia, on an app
            being cited under a guideline about collections of links. And
            "read more" framed the source as the fuller product, which is
            the opposite of what is true now that our own writing is the
            story. */}
        <ThemedText type="smallBold" themeColor="accent">
          Source: Wikipedia ›
        </ThemedText>
      </Pressable>
    </ExternalLink>
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

// memo: the heaviest row by far (a full story part, linkified). Its
// props hold their identity across unrelated re-renders — that's what
// the useMemo blocks in AreaGazetteer exist to guarantee.
const PartRow = memo(function PartRow({
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
});

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
  sourceLink: {
    marginTop: Spacing.three,
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
  linkRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three - 2,
  },
  linkRowStandalone: {
    marginHorizontal: Spacing.four,
    marginVertical: Spacing.three,
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
