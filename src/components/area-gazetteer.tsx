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
  ViewToken,
} from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
// scheduleOnRN, not the deprecated runOnJS (Reanimated 4.3): same hop
// off the UI thread, spelled the way the worklets runtime spells it —
// animated-icon.tsx set the precedent.
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ExternalLink } from '@/components/external-link';
import {
  ChromeEdgeInset,
  GlassChip,
  GlassIslandHeader,
  StoryBackChip,
} from '@/components/glass-header';
import { HistoryCard } from '@/components/history-card';
import { ImageViewer } from '@/components/image-viewer';
import {
  absentRecordCopy,
  FailureCause,
  FailurePanel,
  LoadFailure,
  SavedCopyLine,
} from '@/components/load-failure';
import { SpeechControls, TellingLead, TellingSection } from '@/components/telling-section';
import { ThemedText } from '@/components/themed-text';
import { DrawingWanderLine, WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchArticle, fetchArticleLight } from '@/data/article-client';
import { LoadVerdict, loadVerdict, worstOf } from '@/data/load-verdict';
import { fetchRetold } from '@/data/retold-client';
import { Article, ArticleImage } from '@/types/article';
import { Retold, RetoldPart, TimelineStop } from '@/types/retold';
import { storyParagraphs, stripEmphasis } from '@/utils/format';
import { LinkCandidate, linkifyParagraph, planStoryLinks } from '@/utils/linkify';
import { withoutPullQuote } from '@/utils/pull-quote';
import { readingProgress } from '@/utils/reading-progress';
import { useTheme } from '@/hooks/use-theme';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';
import {
  pauseSpeech,
  resumeSpeech,
  speakAsync,
  speechAvailable,
  speechCanPause,
  stopSpeech,
  usingEnhancedVoice,
} from '@/utils/speech';

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

// The hero is a fixed 220pt frame with its title at the base — by this
// offset the title has left the screen and the island takes over
const HeroClearOffset = 200;
// The floating chips are 40pt circles; a title block below them clears
// their row, not just the notch
const ChipRowHeight = 40;
// The gazetteer's island overlays; nothing below insets around it
const noHeight = () => {};
// Module-level: FlatList requires a stable viewability identity
const partViewability = { itemVisiblePercentThreshold: 25 };

export type GazetteerRow =
  | { kind: 'ai-label'; key: string }
  | { kind: 'no-story'; key: string; copy: string }
  /** The record is empty and we know it: a 404 from BOTH article legs.
   * No panel and no retry — that grammar belongs to failure. */
  | { kind: 'absent-record'; key: string; name: string | null; relics: number }
  /** The ask failed. Venture's fact, not the record's. */
  | { kind: 'load-failed'; key: string; cause: FailureCause }
  /** The phone is offline and this is the saved copy. One grey line. */
  | { kind: 'offline'; key: string; name: string | null; savedAt?: number }
  | { kind: 'record-story'; key: string }
  | { kind: 'brief'; key: string; lines: string[] }
  | { kind: 'timeline'; key: string; stops: TimelineStop[] }
  | { kind: 'part'; key: string; part: RetoldPart; index: number }
  | { kind: 'retelling-pending'; key: string; name: string | null; partsSoFar: number }
  | { kind: 'retelling-halted'; key: string; partsSoFar: number }
  | { kind: 'telling-lead'; key: string }
  | { kind: 'source-link'; key: string }
  | { kind: 'section'; key: string; title: string }
  | { kind: 'relic'; key: string; item: HistoryItem };

/**
 * How much the records actually hold, measured in one grey line and
 * said once. Not an apology — Direction C's whole claim is that a thin
 * screen states its thinness and then moves the reader on ("Thin
 * ground, and where it thickens", #292).
 */
export function recordLine(record: HistoryItem, thickensNearby: boolean): string | null {
  if (record.source.startsWith('Open Plaques')) {
    return 'The plaque is the whole record — no article stands behind it.';
  }
  if (record.source.startsWith('Historic England')) {
    return 'Historic England holds the grade and the position. Nobody has written the rest down.';
  }
  if (!record.extract?.trim()) {
    // The second sentence is a claim about the neighbourhood, so it is
    // only made when there is a neighbourhood to make it about
    return thickensNearby
      ? 'A name and a pin, and nothing written under either. The ground around it is better recorded.'
      : 'A name and a pin, and nothing written under either.';
  }
  // The record has its own words and they are on this screen. A missing
  // article here is equally a fetch that failed, and "nobody wrote this
  // down" would then be a lie — an empty section is a correct answer,
  // an invented one is not.
  return null;
}

/**
 * What the list shows when it holds no rows — a verdict, never an
 * element.
 *
 * This branch used to consult a ReactNode the caller handed in
 * (`empty`), and because a React element is truthy even when it renders
 * null, the default copy below it could not be reached from the one
 * route that needed it — for ANY caller passing a component that can
 * render nothing, not just the place screen (#255, #292). Nothing a
 * caller can pass reaches this decision now, and this signature is what
 * keeps it that way: there is no parameter here to hide the default
 * behind.
 */
export function emptyVerdict(
  articleStatus: 'pending' | 'ready' | 'none',
  hasArticle: boolean
): 'nothing' | 'waiting' | 'default' {
  if (hasArticle) {
    // The header carries the screen; an empty list under a hero is not
    // an empty screen
    return 'nothing';
  }
  return articleStatus === 'pending' ? 'waiting' : 'default';
}

/** The list's own last word, reached when nothing else is. */
export function emptyGazetteerCopy(name?: string | null): string {
  // An invitation that names the control it points at: the area title
  // above IS the search affordance (section-screen's SectionHeader).
  return name
    ? `Nothing is written down within a walk of ${name}. Walk on, or tap the name above to look somewhere else.`
    : 'Nothing is written down within a walk. Walk on, or tap the name above to look somewhere else.';
}

/** How many neighbours a dead end is worth: three, and the walk decides. */
const NearbyOffered = 3;

/** The longest wait in the app, and until #248 it was bare grey text. */
function pendingRow(name: string | null, partsSoFar: number): GazetteerRow {
  return { kind: 'retelling-pending', key: 'retelling-pending', name, partsSoFar };
}

/** Pure and unit-tested: the whole scroll as data. */
export function buildGazetteerRows(options: {
  hasArticle: boolean;
  /**
   * Probed and genuinely absent (never while loading, and never after a
   * failure): the area has a name, and a 404 came back from BOTH
   * article legs. Until #291 this was set by every failure too, so a
   * recycling worker printed a claim about the historical record.
   */
  storyMissing?: boolean;
  /** The ask itself failed. Mutually exclusive with `storyMissing` —
   * that is the whole of the bug this pair exists to keep fixed. */
  articleFailure?: FailureCause;
  /** The feed is serving its saved copy, so the phone is offline. This
   * OUTRANKS both of the above: with no request on the wire we know
   * nothing about the record and must not describe it. */
  offline?: boolean;
  /** When that saved copy was written — the offline line names the day. */
  savedAt?: number;
  retoldStatus: RetoldStatus;
  retold: Retold | null;
  /** Complete parts landed so far by a live (or halted) stream. */
  streamedParts?: RetoldPart[];
  relics: HistoryItem[];
  /** A place screen with a telling to hand: wherever the original
   * article would stand alone as the story, the telling opens it. */
  tellingLead?: boolean;
  /** The place as a reader would say it — the name the copy uses. */
  name?: string | null;
  /** A PLACE screen's OWN record: the plaque, the list entry, the bare
   * Wikipedia pin. Areas pass none — an area simply is its article.
   * This is what used to arrive as the `empty` element (#255): the
   * record now has rows like everything else, so one renderer draws
   * every story screen. */
  record?: HistoryItem;
  /** Where the ground thickens: the stories within a walk, offered when
   * this one's record runs out. The dead end becomes a junction. */
  nearby?: HistoryItem[];
}): GazetteerRow[] {
  const { hasArticle, storyMissing, retoldStatus, retold, relics, record } = options;
  const streamedParts = options.streamedParts ?? [];
  const nearby = (options.nearby ?? []).slice(0, NearbyOffered);
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

  // Offline is checked FIRST, everywhere, because it outranks: the
  // request never left the phone, so nothing below knows anything about
  // the record. It rides above a story that DID load too — the History
  // tab used to serve cached stories with no admission at all while
  // Nearby, on the same flag from the same hook, said "you're offline"
  // (#248).
  if (options.offline) {
    rows.push({
      kind: 'offline',
      key: 'offline',
      name: options.name ?? null,
      savedAt: options.savedAt,
    });
  }
  // Venture's own failure, in the grammar absence is never given: a
  // panel, a cause, and a retry. Withheld when offline — the line above
  // has already said the truer thing, and a retry with no signal is a
  // tap that does nothing.
  if (!hasArticle && !options.offline && options.articleFailure) {
    rows.push({ kind: 'load-failed', key: 'load-failed', cause: options.articleFailure });
  }

  if (!hasArticle && record) {
    /**
     * A PLACE with no article of its own — the case #292 was filed for.
     * The record speaks first (its own words, and Venture's telling of
     * them), then one measured line about how much the records hold,
     * then the ground that is better recorded, then the citation.
     *
     * This used to be an `empty` element handed in by the caller, which
     * is why the whole screen could come out blank: an element that
     * renders null is still truthy, so the list's own empty state was
     * unreachable behind it (#255). Rows can be counted.
     */
    if (record.extract?.trim()) {
      rows.push({ kind: 'record-story', key: 'record-story' });
    }
    // The measured line is a claim about how much the RECORD holds, so
    // it may only be made when the ask actually succeeded and came back
    // empty. After a failure the panel above speaks instead, and
    // "nobody has written the rest down" stays unsaid.
    const line = storyMissing ? recordLine(record, nearby.length > 0) : null;
    if (line) {
      rows.push({ kind: 'no-story', key: 'no-story', copy: line });
    }
    if (nearby.length > 0) {
      rows.push({
        kind: 'section',
        key: 's-nearby',
        title: `Also within a walk · ${nearby.length}`,
      });
      rows.push(
        ...nearby.map((item): GazetteerRow => ({ kind: 'relic', key: String(item.pageId), item }))
      );
    }
    rows.push({ kind: 'source-link', key: 'source-link' });
  } else if (!hasArticle && storyMissing && relics.length > 0) {
    // The wordless miss gets words: a named AREA whose article simply
    // doesn't exist must say so — bare relics with no explanation read
    // as broken (device-triaged, pre-cascade Dorking). With no relics
    // either the row is withheld on purpose: the list's own empty state
    // is the fuller answer, and it can only be reached if nothing else
    // claims the list.
    rows.push({
      kind: 'absent-record',
      key: 'no-story',
      name: options.name ?? null,
      relics: relics.length,
    });
  }

  if (hasArticle) {
    if (retoldStatus === 'ready' && retold) {
      // The ten-second read leads (Edd, 2026-08-06): the lines a
      // stranger standing here most needs, before any part or timeline.
      // Purely additive — everything below renders exactly as before.
      if ((retold.brief ?? []).length > 0) {
        rows.push({ kind: 'brief', key: 'brief', lines: retold.brief });
      }
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
          rows.push(pendingRow(options.name ?? null, 0));
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
            ? pendingRow(options.name ?? null, streamedParts.length)
            : { kind: 'retelling-halted', key: 'retelling-halted', partsSoFar: streamedParts.length }
        );
      }
    } else if (retoldStatus === 'pending') {
      rows.push(pendingRow(options.name ?? null, 0));
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

/**
 * One article leg, with its failure kept rather than flattened.
 *
 * Module-level and deliberately conditional-free inside the `try`: a
 * conditional in a try/catch de-optimises the WHOLE enclosing component
 * under the React Compiler, and this work used to sit inside
 * `AreaGazetteer` (AGENTS.md — "extract it into a module-level async
 * helper that returns a verdict").
 */
type ArticleLeg = { article: Article | null; verdict: LoadVerdict | null };

async function askLeg(ask: Promise<Article>): Promise<ArticleLeg> {
  try {
    return { article: await ask, verdict: null };
  } catch (error) {
    return { article: null, verdict: loadVerdict(error) };
  }
}

/** What the article status is once it stops being pending or ready:
 * the honest verdict, never a flat "none". */
type ArticleStatus = 'pending' | 'ready' | LoadVerdict;

/**
 * The retelling ask, folded into one verdict — and module-level for the
 * same reason as `askLeg`. The `loaded ? 'ready' : 'none'` that used to
 * sit inside this try/catch was de-optimising the WHOLE of
 * `AreaGazetteer`: the compiler bails silently, and the heaviest screen
 * in the app was paying per-render for it.
 */
type RetoldAsk =
  | { status: 'ready'; retold: Retold }
  | { status: 'none' }
  | { status: 'failed'; verdict: LoadVerdict };

function settledRetold(loaded: Retold | null): RetoldAsk {
  return loaded ? { status: 'ready', retold: loaded } : { status: 'none' };
}

async function askRetold(
  name: string,
  onPart: (part: RetoldPart, index: number) => void
): Promise<RetoldAsk> {
  try {
    return settledRetold(await fetchRetold(name, onPart));
  } catch (error) {
    return { status: 'failed', verdict: loadVerdict(error) };
  }
}

/** The hero's meta line — and the tail of its accessible label, so the
 * two cannot drift apart. */
export function heroMeta(retold: Retold | null): string {
  return retold
    ? `${retold.parts.length} parts · about ${retold.minutes} min · retold from Wikipedia`
    : // No retelling (yet): the body below is the telling, about a
      // minute — the article's own minutes and chapter count described
      // a body the screen no longer shows (caught on the simulator)
      'about a minute';
}

function Hero({
  areaName,
  article,
  retold,
  topInset,
}: {
  areaName: string;
  article: Article;
  retold: Retold | null;
  /** Full-bleed screens (glass chrome) grow the hero by the status
   *  inset so the visible frame stays 220pt, and the credit drops
   *  below the clock instead of colliding with it (Edd's phone,
   *  22:10 — the credit ran behind the status bar and the island). */
  topInset?: number;
}) {
  const lead: ArticleImage | undefined = (article.images ?? [])[0];
  return (
    <View style={[styles.hero, { height: 220 + (topInset ?? 0) }]} testID="gazetteer-hero">
      {lead && (
        <Image
          source={{ uri: lead.imageUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      )}
      <View style={[StyleSheet.absoluteFill, styles.heroShade]} testID="hero-scrim" />
      {lead && (
        <ThemedText
          type="caption"
          style={styles.heroCredit}
          numberOfLines={1}
          maxFontSizeMultiplier={1.4}>
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
          {heroMeta(retold)}
        </ThemedText>
      </View>
    </View>
  );
}

function useRetoldSpeaker(retold: Retold | null) {
  const [speaking, setSpeaking] = useState(false);
  const [paused, setPaused] = useState(false);
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
      setPaused(false);
      return;
    }
    if (!retold) {
      return;
    }
    cancelled.current = false;
    setEngineFailed(false);
    setSpokeOnce(true);
    setSpeaking(true);
    setPaused(false);
    // A pause holds this loop where it stands: the awaited utterance
    // only settles on done, stop or error, so a part paused mid-body
    // resumes mid-body — the loop never advances over a paused reading.
    for (const [index, part] of retold.parts.entries()) {
      if (cancelled.current) {
        return;
      }
      const outcome = await speakAsync(`Part ${index + 1}: ${part.heading}.`);
      if (outcome === 'error') {
        // A broken engine must say so, not mime success
        setEngineFailed(true);
        setSpeaking(false);
        setPaused(false);
        return;
      }
      if (cancelled.current) {
        return;
      }
      const bodyOutcome = await speakAsync(part.body);
      if (bodyOutcome === 'error') {
        // Mid-body is exactly where a failed resume settles as 'error'.
        // Reading on to Part n+1 over a broken engine would announce
        // headings nobody can hear — stop and say so instead.
        setEngineFailed(true);
        setSpeaking(false);
        setPaused(false);
        return;
      }
    }
    if (!cancelled.current) {
      setSpeaking(false);
      setPaused(false);
    }
  }, [speaking, retold]);

  const pause = useCallback(async () => {
    if ((await pauseSpeech()) === 'paused') {
      setPaused(true);
    }
  }, []);

  const resume = useCallback(async () => {
    if ((await resumeSpeech()) === 'speaking') {
      setPaused(false);
    }
    // On 'error' the in-flight utterance settles as 'error' and the
    // loop above surfaces it — one channel for every engine failure
  }, []);

  return { speaking, paused, engineFailed, spokeOnce, toggle, pause, resume };
}

export function AreaGazetteer({
  areaName,
  areaLabel,
  areaSettled = true,
  relics,
  allStories,
  refreshing,
  onRefresh,
  stale,
  savedAt,
  lead,
  record,
  sourceUrl,
  tellingItem,
  onReadThreshold,
  chrome,
  from,
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
  /** The feed reaching this screen is the phone's saved copy — the
   * network is gone. The tab admits it in one grey line (#248): Nearby
   * has said "you're offline" for months on this very flag, and History
   * said nothing at all on the same data from the same hook. */
  stale?: boolean;
  /** When that saved copy was written. */
  savedAt?: number;
  /** The reader's live position, for the relic cards' walk times —
   * HistoryCard's own `from` contract (#323): the feed no longer
   * re-mints distances by refetching as they move, so the cards
   * recompute from here instead. Callers keep its identity coarse
   * (GazetteerBody steps it per ~111m bucket): this screen re-renders
   * when it changes. Absent, compose-time figures stand. */
  from?: Coordinates;
  /** Rendered in the header under the hero — a place screen's Go row. */
  lead?: ReactNode;
  /**
   * A PLACE screen's own record — the plaque, the list entry, the bare
   * Wikipedia pin. It names the screen when no article does, it decides
   * the measured line, and it is what the citation cites. Areas pass
   * none.
   *
   * It replaces the old `empty` element (#255, #292). That prop handed
   * this component a ReactNode which could render nothing, and because
   * an element is truthy either way the list's own empty copy sat
   * behind a branch no caller could stop taking. There is no such
   * branch now: the record has rows, and rows can be counted.
   */
  record?: HistoryItem;
  /** Where the citation points. A place passes the URL of the thing it
   * actually showed — its own article, or (unresolved) its record.
   * Areas pass none and the link derives from the area name instead. */
  sourceUrl?: string;
  /** When a place has a story to tell (its own extract, no separate
   * subject), the fallback article gets a telling lead: the AI-told
   * opening above the original, with Listen. Areas pass none. */
  tellingItem?: HistoryItem;
  /** Fired ONCE per story when the reading bar passes ~60% — the
   * journal's definition of "read" (an open is not a read). Place
   * screens pass the journal mark; areas pass none. */
  onReadThreshold?: () => void;
  /**
   * A story SCREEN's navigation, worn as glass (Edd, 2026-08-06 —
   * "replace the default header with the liquid glass header"): the
   * native Stack header is hidden, the hero runs full-bleed to the
   * screen top, and this renders the back chip and the ⋯ menu as
   * floating glass over it. When the island arrives on scroll, the
   * back button docks into it. The History TAB passes none — the tab
   * pill is its navigation, and its island stays informational.
   */
  chrome?: {
    backLabel: string;
    onBack: () => void;
    /** The ⋯ as rendered ON the island's own surface (theme glyph). */
    menu?: ReactNode;
    /** The same ⋯ tinted white for the photo-scrim chip at rest. */
    menuOnPhoto?: ReactNode;
  };
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
  // The island's arrival is a threshold, not a fade: animating opacity
  // over a GlassView DISABLES the glass (vendor caveat), so the island
  // mounts and unmounts on the crossing, one JS hop per change.
  // Declared before the scroll handler that writes it.
  const heroCleared = useSharedValue(0);
  // The hero is full-bleed on BOTH screens now (direction B): the tab
  // keeps its magazine cover and wears no chrome until the cover has
  // gone, exactly as the story screen does. One offset, no branch.
  const heroClearAt = HeroClearOffset + insets.top;
  const [islandShown, setIslandShown] = useState(false);
  useAnimatedReaction(
    () => heroCleared.get(),
    (cleared, previous) => {
      if (cleared !== previous) {
        scheduleOnRN(setIslandShown, cleared === 1);
      }
    }
  );
  const onScroll = useAnimatedScrollHandler((event) => {
    const progress = readingProgress(
      event.contentOffset.y,
      event.contentSize.height,
      event.layoutMeasurement.height
    );
    readProgress.set(progress);
    // The arriving island (Edd, 2026-08-06): once the hero's title has
    // cleared the top edge, the glass island carries it on. Full-bleed
    // screens grew the hero by the status inset, so the title clears
    // that much later.
    heroCleared.set(event.contentOffset.y > heroClearAt ? 1 : 0);
    if (onReadThreshold && progress >= ReadThreshold && !readMarked.get()) {
      readMarked.set(true);
      scheduleOnRN(onReadThreshold);
    }
  });
  const fillStyle = useAnimatedStyle(() => ({
    width: `${readProgress.get() * 100}%`,
  }));
  // Which part the reader is in, for the island's counter — viewability
  // granularity, and it never regresses to zero between rows
  const [currentPart, setCurrentPart] = useState(1);
  // …and whether they have left the telling for the ground beneath it.
  // The counter is honest about where in the SCREEN you are: it counts
  // parts while you are reading them and counts relics once you reach
  // them, which is where the History tab's missing count line lands.
  const [onGround, setOnGround] = useState(false);
  const onViewableRows = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const partsInView = viewableItems.filter(
      (token) => (token.item as GazetteerRow).kind === 'part'
    );
    const last = partsInView.at(-1)?.item as (GazetteerRow & { kind: 'part' }) | undefined;
    if (last) {
      setCurrentPart(last.index + 1);
    }
    // The ground announces itself with its own section head, so the
    // flip happens on the row the reader can see rather than on a
    // scroll offset nobody can point at.
    setOnGround(
      viewableItems.some((token) => {
        const kind = (token.item as GazetteerRow).kind;
        return kind === 'relic' || kind === 'section';
      })
    );
  }, []);
  // The bar no longer needs measuring for its own sake: it has ONE home
  // now, along the island's base, and the island only exists once the
  // reader has scrolled a hero's worth — which is the same question
  // "is there anything to read?" asked by the screen instead of by a
  // second measurement of the content box.
  const listRef = useRef<FlatList<GazetteerRow>>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [articleStatus, setArticleStatus] = useState<ArticleStatus>('pending');
  const [articleAttempt, setArticleAttempt] = useState(0);
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
  const { speaking, paused, engineFailed, spokeOnce, toggle, pause, resume } =
    useRetoldSpeaker(retold);

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
    // The island belongs to the story that scrolled, not the next one
    setIslandShown(false);
    setCurrentPart(1);
  }

  // …and must not inherit its reading progress. An effect, not the
  // adjust block above: writing a shared value during render trips
  // Reanimated's strict mode (verified on the sim), and the reset
  // only needs to land before the next area's story can scroll —
  // its fetches haven't even resolved by the time this runs.
  useEffect(() => {
    readProgress.set(0);
    readMarked.set(false);
    heroCleared.set(0);
  }, [areaName, readProgress, readMarked, heroCleared]);

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
      const fullAsk = askLeg(fetchArticle(areaName)).then((leg) => {
        if (active && leg.article) {
          fullLanded = true;
          setArticle(leg.article);
          setArticleStatus('ready');
        }
        return leg;
      });
      const light = await askLeg(fetchArticleLight(areaName));
      if (active && light.article && !fullLanded) {
        setArticle(light.article);
        setArticleStatus('ready');
      }
      const full = await fullAsk;
      if (active && !full.article && !light.article) {
        // Only a double miss ends the ask — a painted light article
        // never flashes away because the image leg failed. And only a
        // double 404 is ABSENCE: worstOf keeps the strongest claim on
        // the list ("history has no record here") behind unanimity,
        // so one flaky leg can no longer speak for the record (#291).
        setArticleStatus(worstOf(full.verdict ?? 'silent', light.verdict ?? 'silent'));
      }
    })();
    return () => {
      active = false;
    };
  }, [areaName, articleAttempt]);

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
      // A server cache hit resolves in one hop; a cold generation
      // streams — each complete part renders the moment it lands
      const ask = await askRetold(areaName, (part, index) => {
        if (!active) {
          return;
        }
        streamedRef.current = [...streamedRef.current.slice(0, index), part];
        setStreamedParts(streamedRef.current);
        setRetoldStatus('streaming');
      });
      if (!active) {
        return;
      }
      if (ask.status === 'ready') {
        setRetold(ask.retold);
        setRetoldStatus('ready');
        return;
      }
      // A 404 is the server's verdict ("no retelling") — fall back to
      // the original article. Anything else mid-stream keeps what
      // arrived and offers a retry; with nothing arrived, the
      // original article stands, as it always has.
      const halted =
        ask.status === 'failed' && ask.verdict !== 'absent' && streamedRef.current.length > 0;
      setRetoldStatus(halted ? 'halted' : 'none');
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
  const resolvedArticleStatus: ArticleStatus = areaMissing ? 'absent' : articleStatus;
  const resolvedRetoldStatus = areaMissing ? 'none' : retoldStatus;
  const articleSettled = resolvedArticleStatus !== 'pending' && resolvedArticleStatus !== 'ready';
  // Offline outranks every other verdict (the mock's rule 2): the feed
  // on this screen is the phone's saved copy, so nothing left the phone
  // and nothing here knows anything about the record.
  const articleVerdict: LoadVerdict | null = !articleSettled
    ? null
    : stale
      ? 'offline'
      : resolvedArticleStatus;

  // Memoized from here down: renderItem's inputs must hold their
  // identity across unrelated re-renders (scroll, speech, the image
  // viewer) or every visible row pays for them
  // The area's own article leads the screen, not the list
  const listRelics = useMemo(
    () => relics.filter((item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase()),
    [relics, areaName]
  );
  // The name as a reader would say it — the hero's, the copy's, and
  // (with no article) the screen's own title
  const spokenName = areaLabel ?? areaName;
  // Whether the hero paints: the one fact the floating chips need,
  // because their material follows what they sit on and nothing else
  const onPhoto = article !== null && areaName !== null;
  // The three settled verdicts all mean "no article", which is the only
  // thing the empty state ever asked. Whichever it is, a row now claims
  // the list — so the list's own last word is reached by a genuine 404
  // with no relics, and by nothing else.
  const emptyState = emptyVerdict(
    resolvedArticleStatus === 'pending' || resolvedArticleStatus === 'ready'
      ? resolvedArticleStatus
      : 'none',
    article !== null
  );
  // Where the ground thickens: the neighbourhood the feed already
  // handed us, minus this place itself. Only ever offered on a dead
  // end, so a healthy screen is untouched by #292.
  const nearby = useMemo(
    () =>
      allStories.filter((item) => item.title.toLowerCase() !== (areaName ?? '').toLowerCase()),
    [allStories, areaName]
  );
  const rows = useMemo(
    () =>
      buildGazetteerRows({
        hasArticle: article !== null,
        // Absence, and only absence: a 404 from both legs, with a name
        // to say it about. A 502 or a timeout now takes the branch
        // below instead of claiming history is silent here (#291).
        storyMissing: articleVerdict === 'absent' && areaName !== null,
        articleFailure:
          articleVerdict === 'silent' || articleVerdict === 'errored' ? articleVerdict : undefined,
        offline: stale,
        savedAt,
        retoldStatus: resolvedRetoldStatus,
        retold,
        streamedParts,
        relics: listRelics,
        tellingLead: tellingItem !== undefined,
        name: spokenName,
        // Never while the article is still in flight: a record line
        // that says "nobody wrote this down" during a fetch is a lie
        // with a half-second lifetime
        record: articleVerdict !== null ? record : undefined,
        nearby,
      }),
    [
      article,
      articleVerdict,
      stale,
      savedAt,
      areaName,
      resolvedRetoldStatus,
      retold,
      streamedParts,
      listRelics,
      tellingItem,
      spokenName,
      record,
      nearby,
    ]
  );

  const linkCandidates: LinkCandidate[] = useMemo(
    () => nearby.map((item) => ({ title: item.title, pageId: item.pageId })),
    [nearby]
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
  // …and what it is a source OF. With an article the story came from
  // Wikipedia whatever the record is badged; with none, the link goes
  // to the record itself and must say so — "Source: Wikipedia" over a
  // link to openplaques.org was a small lie nobody could see until the
  // record got a screen of its own. The grade rides in the meta line,
  // not in a citation label ("Historic England · Grade II" → the name).
  const linkSource = article ? 'Wikipedia' : (record?.source.split(' · ')[0] ?? 'Wikipedia');

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<GazetteerRow>) => {
    switch (row.kind) {
      case 'no-story':
        // One measured grey line, in the house voice — a measurement,
        // not an apology. Grey because it is neither interactive nor a
        // name, which is the whole of DESIGN.md's rule of use.
        return (
          <ThemedText type="small" themeColor="textSecondary" style={styles.noStory}>
            {row.copy}
          </ThemedText>
        );
      case 'absent-record':
        // Absence, and the grammar it keeps to itself: an eyebrow and a
        // statement. No panel, no button — the ask WORKED, and a retry
        // against a 404 teaches a reader that their tap does nothing.
        return <AbsentRecord name={row.name} relics={row.relics} />;
      case 'load-failed':
        return (
          <LoadFailure
            surface="area-article"
            cause={row.cause}
            onRetry={() => {
              setArticleStatus('pending');
              setArticleAttempt((attempt) => attempt + 1);
            }}
          />
        );
      case 'offline':
        return <SavedCopyLine name={row.name} savedAt={row.savedAt} />;
      case 'record-story':
        // The record's own words, and Venture's telling of them. This
        // is ExtractStory, folded in from the place screen (#255) — the
        // last of the three story-rendering regimes to become a row.
        return record ? <RecordStory record={record} /> : null;
      case 'ai-label':
        return (
          <View>
          <View style={styles.aiLabel}>
            {/* Words, not glyphs (PR #186): no ✦ for VoiceOver to call
                "four-pointed star", and Stop is a word — it's violet,
                and violet already means tappable */}
            <ThemedText type="caption" themeColor="textSecondary" style={styles.aiLabelText}>
              Retold by AI from Wikipedia — source below
            </ThemedText>
            {speechAvailable && retold && speaking && speechCanPause && (
              <SpeechControls paused={paused} onPause={pause} onResume={resume} onStop={toggle} />
            )}
            {speechAvailable && retold && !(speaking && speechCanPause) && (
              // 16pt slop on the 20px label clears the 44pt target
              <Pressable accessibilityRole="button" onPress={() => void toggle()} hitSlop={Spacing.three}>
                <ThemedText type="smallBold" themeColor="accent">
                  {speaking ? 'Stop' : engineFailed ? 'Speech failed · retry' : 'Listen'}
                </ThemedText>
              </Pressable>
            )}
          </View>
          {spokeOnce && !speaking && !usingEnhancedVoice() && (
            <ThemedText type="caption" themeColor="textSecondary" style={styles.voiceHint}>
              A nicer voice is one download away: Settings › Accessibility › Spoken Content ›
              Voices › English (UK)
            </ThemedText>
          )}
          </View>
        );
      case 'brief':
        return <BriefCard lines={row.lines} />;
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
        // The longest wait in the app. It got bare grey text while the
        // purpose-built, reduced-motion-aware line sat unused outside
        // cold load (#248) — so the slowest moment is now the one that
        // looks most like Venture, with a door out beside it.
        return (
          <RetellingPending name={row.name} partsSoFar={row.partsSoFar} articleUrl={articleUrl} />
        );
      case 'retelling-halted':
        // The stream broke: honest words that say WHERE it stopped, and
        // the offer to finish — a re-ask restarts the whole generation
        // (still one call site).
        return (
          <RetellingHalted
            partsSoFar={row.partsSoFar}
            onRetry={() => {
              setRetoldStatus('streaming');
              setRetoldAttempt((attempt) => attempt + 1);
            }}
          />
        );
      case 'telling-lead':
        return tellingItem ? <TellingLead item={tellingItem} /> : null;
      case 'source-link':
        // The telling read, the source one tap away — in the browser,
        // not behind an inline door (Edd's ruling)
        return articleUrl ? <SourceLinkRow href={articleUrl} source={linkSource} /> : null;
      case 'section':
        return (
          <ThemedText type="eyebrow" themeColor="textSecondary" style={styles.sectionHead}>
            {row.title}
          </ThemedText>
        );
      case 'relic':
        return (
          <View style={styles.cardWrap}>
            <HistoryCard item={row.item} archive from={from} />
          </View>
        );
    }
    },
    [
      speaking,
      paused,
      engineFailed,
      spokeOnce,
      toggle,
      pause,
      resume,
      retold,
      jumpToPart,
      partParagraphs,
      linkPlan,
      tellingItem,
      articleUrl,
      linkSource,
      record,
      from,
    ]
  );

  /**
   * The island's counter slot, and the whole of what the History tab's
   * missing count line became. It says where in the SCREEN the reader
   * is: their place in the telling while they are in it, and the size
   * of the ground once they have reached it. An area with no telling
   * has no parts to count, so it counts relics from the first frame.
   */
  const partCount = retold?.parts.length ?? 0;
  const islandCounter =
    partCount > 0 && !onGround
      ? `${currentPart} / ${partCount}`
      : `${relics.length} ${relics.length === 1 ? 'relic' : 'relics'}`;

  return (
    <View style={styles.wrap}>
    {/* The chrome renders FIRST in JSX (#296): UIKit derives VoiceOver's
        reading order from subview traversal, and with the list first a
        blind reader swiped through the whole article before finding the
        way out — on a story screen the back button was the LAST element.
        Paint order is unaffected: both chrome roots carry zIndex 10, so
        they draw above the list wherever they sit in source. */}
    {/* A story screen's standing chrome: back and the ⋯, floating as
        glass chips over the full-bleed hero — the native header's job,
        rehoused (Edd's ask). They stand down when the island arrives
        and carries the back button itself.

        The material follows what it sits ON (DESIGN.md, Glass). With a
        hero the chips sit on a photograph and pin dark under white
        glyphs; with no article there is no photograph, and a dark disc
        with a white chevron floating on a white page is the rule read
        backwards. On the page they take the island's rendering: theme
        glass, theme ink, and the ⋯ drawn for a theme surface. */}
    {chrome && !islandShown && (
      <View
        style={[styles.chipRow, { top: insets.top + Spacing.two }]}
        pointerEvents="box-none">
        <StoryBackChip
          backLabel={chrome.backLabel}
          over={onPhoto ? 'photo' : 'page'}
          onPress={chrome.onBack}
        />
        {(onPhoto ? chrome.menuOnPhoto : chrome.menu) && (
          <GlassChip circle over={onPhoto ? 'photo' : 'page'}>
            {onPhoto ? chrome.menuOnPhoto : chrome.menu}
          </GlassChip>
        )}
      </View>
    )}
    {/* The arriving island (direction B, #300): an island exists to
        carry a title the screen can no longer show, so it arrives on
        the hero clearing and on NOTHING ELSE. It used to be gated on
        `islandShown && retold`, which meant an area Wikipedia never
        retold scrolled forever with no chrome and no title — not "late",
        never. The gate belongs on the hero, not on whether the AI had
        something to say.

        The tab gets the same one professional row minus the chevron,
        which the tab pill makes unnecessary, and the reading bar lives
        along its base — the app's one progress idiom, with one home. */}
    {islandShown && (
      <GlassIslandHeader onHeight={noHeight} passThrough={!chrome}>
        <View style={styles.islandInner} testID="gazetteer-island">
          {/* One professional row (Edd, 22:25): chevron · title · count
              · menu, with the reading bar along the base */}
          <View style={styles.islandRow}>
            {chrome && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Back to ${chrome.backLabel}`}
                testID="story-back"
                onPress={chrome.onBack}
                hitSlop={Spacing.two}>
                <ThemedText type="title" style={styles.chevron}>
                  ‹
                </ThemedText>
              </Pressable>
            )}
            <ThemedText type="smallBold" style={styles.islandTitle} numberOfLines={1}>
              The story of {areaLabel ?? areaName}
            </ThemedText>
            <ThemedText type="eyebrow" themeColor="textSecondary" testID="island-counter">
              {islandCounter}
            </ThemedText>
            {chrome?.menu}
          </View>
          <View
            style={[styles.islandTrack, { backgroundColor: theme.accentSoft }]}
            pointerEvents="none">
            <Animated.View
              style={[styles.progressFill, { backgroundColor: theme.accent }, fillStyle]}
            />
          </View>
        </View>
      </GlassIslandHeader>
    )}
    <Animated.FlatList
      ref={listRef}
      testID="gazetteer-list"
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={renderItem}
      onScroll={onScroll}
      // 16, not 32: the events no longer cross the bridge, so every
      // frame can feed the bar for free
      scrollEventThrottle={16}
      // The island's part counter reads the last part in view
      onViewableItemsChanged={onViewableRows}
      viewabilityConfig={partViewability}
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
              // The hero is the ONLY place the story's name renders
              // before the island arrives, and an explicit label on an
              // accessible container REPLACES the children's text on
              // iOS — "Open the cover photo, image button" was the
              // whole screen to VoiceOver, and which story it was never
              // arrived (#296). The label now carries what the hero
              // shows; the tap is the hint.
              accessibilityLabel={`The story of ${areaLabel ?? areaName}. ${heroMeta(retold)}`}
              accessibilityHint="Opens the cover photo"
              onPress={() => (article.images ?? []).length > 0 && setViewerIndex(0)}>
              <Hero
                areaName={areaLabel ?? areaName}
                article={article}
                retold={retold}
                topInset={insets.top}
              />
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
                      type="caption"
                      themeColor="textSecondary"
                      numberOfLines={1}>
                      {image.credit}
                    </ThemedText>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {lead}
          </View>
        ) : spokenName ? (
          // The name renders whether or not an article does (#292). The
          // hero is the PHOTOGRAPHIC treatment of a title block that
          // always exists; with no photograph the block stands on the
          // page in the same ramp and the same 24pt padding.
          //
          // AREAS take it too now. They used to lean on the History
          // tab's own standing section header to say where the reader
          // was — and direction B takes that header away, because the
          // hero is the title. With no article there is no hero, so
          // this block IS the title, and it is what the island later
          // arrives to carry. A screen that never names its place was
          // exactly the #292 regression.
          <View>
            <RecordTitle
              name={spokenName}
              source={record?.source}
              topPad={
                chrome ? insets.top + ChipRowHeight + Spacing.three : insets.top + Spacing.three
              }
            />
            {lead}
          </View>
        ) : lead ? (
          <View>{lead}</View>
        ) : null
      }
      ListEmptyComponent={
        // A verdict decides this, and nothing a caller passes reaches
        // the verdict (#255). Mock 1: the same quiet accent wander line
        // as the feed's — static, above the words.
        emptyState === 'nothing' ? null : emptyState === 'waiting' ? (
          <ActivityIndicator style={styles.empty} />
        ) : (
          <View style={styles.empty} testID="gazetteer-empty">
            <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
            <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
              {emptyGazetteerCopy(spokenName)}
            </ThemedText>
          </View>
        )
      }
    />
    <ImageViewer
      images={article?.images ?? []}
      initialIndex={viewerIndex}
      onClose={() => setViewerIndex(null)}
    />
    </View>
  );
}


/**
 * The record is empty, said in the grammar failure never gets: an
 * eyebrow, a statement, and the relics. No surface, no button.
 *
 * That difference is the fix, not decoration. If a reader cannot tell
 * "history has no record here" from "we failed to ask" at a glance,
 * without reading the words, #291 is still open — and a retry offered
 * against a 404 would teach them their tap does nothing.
 */
function AbsentRecord({ name, relics }: { name: string | null; relics: number }) {
  const copy = absentRecordCopy(name ?? 'this area', relics);
  return (
    <View style={styles.absent} testID="gazetteer-absent">
      <ThemedText type="eyebrow" themeColor="textSecondary">
        No record
      </ThemedText>
      <ThemedText type="title">{copy.title}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {copy.line}
      </ThemedText>
    </View>
  );
}

/**
 * The AI write, instrumented. Before the first part lands it is the
 * whole screen, so it gets the panel, the drawing wander line and a
 * door out to the source; once parts are arriving the story is the
 * screen and this shrinks to one line under it.
 */
function RetellingPending({
  name,
  partsSoFar,
  articleUrl,
}: {
  name: string | null;
  partsSoFar: number;
  articleUrl?: string;
}) {
  const theme = useTheme();
  if (partsSoFar > 0) {
    return (
      <View style={styles.pendingLine} testID="retelling-pending">
        <DrawingWanderLine arcSpan={38} stroke={4.5} count={4} color={theme.accent} />
        <ThemedText type="small" themeColor="textSecondary">
          Part {PartWords[partsSoFar] ?? partsSoFar + 1}, writing…
        </ThemedText>
      </View>
    );
  }
  return (
    <View
      style={[styles.pendingPanel, { backgroundColor: theme.backgroundElement }]}
      testID="retelling-pending">
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Retelling
      </ThemedText>
      <DrawingWanderLine arcSpan={38} stroke={4.5} count={4} color={theme.accent} />
      <ThemedText type="headline">
        {name ? `Writing the retelling of ${name}` : 'Writing the retelling'}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        It arrives a part at a time, each one appearing as it is written.
      </ThemedText>
      {articleUrl && (
        // A long wait deserves a door out, and the door is a word
        <ExternalLink href={articleUrl as `https://${string}`} asChild>
          <Pressable
            accessibilityRole="link"
            testID="retelling-read-source"
            style={StyleSheet.flatten([styles.quietAction])}>
            <ThemedText type="smallBold" themeColor="accent">
              Read the Wikipedia article instead
            </ThemedText>
          </Pressable>
        </ExternalLink>
      )}
    </View>
  );
}

/** The stream broke. It says where, keeps what arrived, and offers the
 * rest — the same panel every other failure wears. */
function RetellingHalted({ partsSoFar, onRetry }: { partsSoFar: number; onRetry: () => void }) {
  return (
    <View style={styles.haltedWrap}>
      <FailurePanel
        headline={`Stopped after part ${partsSoFar}`}
        body="The connection dropped mid-sentence. What’s written above stays."
        action="Write the rest"
        onAction={onRetry}
        testID="retelling-halted"
        actionTestID="retell-retry"
      />
    </View>
  );
}

/**
 * The name, on the page instead of on a photograph — the hero's title
 * block with the photograph subtracted. Same ramp, same 24pt padding,
 * and the meta line does what the hero's does: names the source, which
 * for a record with no article is the whole of what we know about it
 * ("Open Plaques", "Historic England · Grade II").
 */
function RecordTitle({
  name,
  source,
  topPad,
}: {
  name: string;
  /** A record's source is the whole of what we know about it. An AREA
   *  with no article has no such line to give — and no source is a
   *  correct answer, so the block is the name alone. */
  source?: string;
  /** Clears the floating chips on a chrome screen; the status bar
   *  otherwise — every gazetteer runs full-bleed now. */
  topPad: number;
}) {
  return (
    <View style={[styles.recordTitle, { paddingTop: topPad }]} testID="gazetteer-title">
      <ThemedText type="largeTitle">{name}</ThemedText>
      {source && (
        <ThemedText type="small" themeColor="textSecondary">
          {source}
        </ThemedText>
      )}
    </View>
  );
}

/**
 * A record's own story: Venture's telling of it behind a press, and the
 * record's words beneath. Lifted verbatim out of the place screen's
 * `ExtractStory` (#255) so one renderer draws every story screen — the
 * only change is that its citation is now the list's own source-link
 * row, where every other path already put it.
 */
function RecordStory({ record }: { record: HistoryItem }) {
  // A plaque's extract IS its inscription, and the lead's "The plaque
  // reads" block already shows it — saying it twice reads as broken
  const inscriptionShownAbove = record.source.startsWith('Open Plaques');
  return (
    <View style={styles.recordStory}>
      <ThemedText type="eyebrow" themeColor="textSecondary">
        Story
      </ThemedText>
      <TellingSection item={record} />
      {/* Reading type (16/24), real paragraphs — an extract is a
          story body, not a meta line */}
      {!inscriptionShownAbove &&
        storyParagraphs(record.extract ?? '').map((paragraph, index) => (
          <ThemedText key={index} type="default">
            {paragraph}
          </ThemedText>
        ))}
    </View>
  );
}

/** The one way out to the source, wherever it stands: opens the record
 * in the browser, naming what it is a source of. */
function SourceLinkRow({ href, source }: { href: string; source: string }) {
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
        accessibilityLabel={`Read the record on ${source}`}
        testID="wikipedia-link"
        // Flattened: expo-router's Slot warns on style arrays reaching
        // an asChild child, and the warning is a real one — it cannot
        // merge them for you
        style={StyleSheet.flatten([
          styles.linkRow,
          styles.linkRowStandalone,
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
          Source: {source} ›
        </ThemedText>
      </Pressable>
    </ExternalLink>
  );
}

/**
 * The quiet card (Edd's pick from the three mocked treatments): the
 * brief worn as furniture — a surface card, one fact per line, hairline
 * separations. Scan it or skip it; everything below is untouched.
 */
function BriefCard({ lines }: { lines: string[] }) {
  const theme = useTheme();
  return (
    <View
      style={[styles.briefCard, { backgroundColor: theme.backgroundElement }]}
      testID="brief-card">
      <ThemedText type="eyebrow" themeColor="accent">
        In brief
      </ThemedText>
      {lines.map((line, index) => (
        <View
          key={index}
          style={
            index > 0 && [
              styles.briefLine,
              { borderTopWidth: 1, borderTopColor: theme.backgroundSelected },
            ]
          }>
          <ThemedText type="small">{line}</ThemedText>
        </View>
      ))}
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
          <ThemedText type="caption" numberOfLines={2}>
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
      <ThemedText type="title" style={styles.partHead}>
        {part.heading}
      </ThemedText>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <View key={paragraphIndex}>
          <ThemedText
            type={index === 0 && paragraphIndex === 0 ? 'lede' : 'default'}
            style={styles.para}>
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
              <ThemedText type="pullQuote">
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
  briefCard: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  briefLine: {
    paddingTop: Spacing.two,
  },
  chipRow: {
    position: 'absolute',
    left: ChromeEdgeInset,
    right: ChromeEdgeInset,
    zIndex: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  // Sized to read as an icon, nudged up — the glyph's baseline sits low
  chevron: {
    lineHeight: 24,
    marginTop: -2,
  },
  islandInner: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two + 2,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  islandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two + 2,
  },
  islandTitle: {
    flex: 1,
  },
  islandTrack: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  // 4px, not 3: thick enough to register at a glance, thin enough to
  // stay a bar and not a banner
  progressFill: {
    height: 4,
  },
  hero: {
    justifyContent: 'flex-end',
    backgroundColor: '#31406B',
  },
  // The widget's four-stop scrim, ported (#298). A flat 0.35 guaranteed
  // nothing: over a bright sky it composited to ~#A6A6A6 and the white
  // largeTitle read at 2.44:1, the credit at 1.92:1 — content-dependent
  // and invisible in testing. The gradient keeps the photograph bright
  // where no text sits and darkens its foot to >=0.78 where every line
  // lives, the exact recipe area-stories.tsx wears with the comment
  // "Photographs are unpredictable". CSS-gradient style, not a package:
  // RN 0.76+ draws this natively on the new architecture, which
  // Reanimated 4 already makes a hard requirement of this app.
  heroShade: {
    experimental_backgroundImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.78) 70%, rgba(0,0,0,0.95) 100%)',
  },
  heroText: {
    padding: Spacing.four,
    gap: 2,
  },
  // White holds on the shaded photo in both modes
  heroLight: {
    color: '#FFFFFF',
  },
  // Full white, no opacity dim: 0.85 and 0.7 subtracted from a contrast
  // margin the scrim now exists to guarantee (#298). Hierarchy comes
  // from the type ramp, not from thinning the ink.
  heroDim: {
    color: '#FFFFFF',
  },
  // Bottom-right, where photo credits live — the top edge belongs to
  // the clock, the chips and the notch (Edd's phone, 22:10 and 22:18:
  // the credit fought all three and lost twice)
  heroCredit: {
    position: 'absolute',
    bottom: Spacing.two,
    right: Spacing.three,
    maxWidth: '55%',
    color: '#FFFFFF',
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

  // The hero's own text padding, with the photograph subtracted
  recordTitle: {
    paddingHorizontal: Spacing.four,
    gap: 2,
  },
  recordStory: {
    padding: Spacing.four,
    gap: Spacing.three,
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
  },
  voiceHint: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.one,
  },
  // Absence: no surface and no border. The words are the whole state.
  absent: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    gap: Spacing.one,
  },
  pendingPanel: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.two,
  },
  pendingLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  // 44pt, left-aligned: a word on the page, not a filled button
  quietAction: {
    height: 44,
    justifyContent: 'center',
  },
  haltedWrap: {
    paddingBottom: Spacing.two,
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
    marginBottom: Spacing.two,
  },
  para: {
    marginBottom: Spacing.three,
  },

  pull: {
    borderLeftWidth: 3,
    paddingLeft: Spacing.three,
    paddingVertical: 2,
    marginBottom: Spacing.three,
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
