import { Component, ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { QuizRun } from '@/components/quiz-run';
import { LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchQuiz } from '@/data/quiz-client';
import { useAreaName } from '@/hooks/use-area-name';
import { useHistory } from '@/hooks/use-history';
import { useTheme } from '@/hooks/use-theme';
import { Quiz } from '@/types/quiz';
import { Coordinates } from '@/utils/geo';
import { pointableStory } from '@/utils/quiz-direction';

/**
 * The quiz tab: questions about the ground you are standing on, set by
 * the app from the stories it found there — four registers of question
 * and the pointing finale (the run itself lives in quiz-run.tsx).
 *
 * A tab must never be empty, which is the whole design constraint here.
 * A quiet corner gets a shorter quiz (the server's floor is three), and
 * a corner too quiet even for that gets words and a way onward — never
 * a blank screen under a tab someone deliberately tapped.
 *
 * Every question cites the story it was set from, and the citation is
 * the tap target: answering is an invitation to go and read the thing.
 */

type Phase = 'loading' | 'ready' | 'none' | 'error';

/**
 * How many of the feed's stories the quiz is set from. The server reads
 * the nearest twelve and its route refuses more than forty, so sending
 * the whole feed was both wasteful and a hard failure in any dense area.
 */
const QuizStories = 12;

/**
 * A crash in the quiz must not kill the tab. The pointing question is
 * driven by a sensor no simulator has and worklets no test executes for
 * real, so this is the one surface where a defect can reach a phone with
 * every check green — it did once (a missing 'worklet' directive, fatal
 * on the first magnetometer tick). The boundary turns the next one into
 * words and a retry, and SHOWS the message so a report from a phone
 * carries the diagnosis with it.
 */
class QuizGuard extends Component<
  { children: ReactNode; onRetry?: () => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.centered} testID="quiz-crashed">
          <ThemedText type="small" themeColor="textSecondary">
            The quiz hit a bug. ({this.state.error.message})
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            testID="quiz-crash-retry"
            onPress={() => {
              this.setState({ error: null });
              // A fresh FETCH, not a re-render of the same broken data —
              // re-mounting identical children just crashes identically
              this.props.onRetry?.();
            }}>
            <ThemedText type="linkPrimary">Try again</ThemedText>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export function QuizScreen() {
  return (
    <LocationGate>
      {({ center, exploring, locationDenied, onBackToNearMe }) => (
        <QuizBody
          center={center}
          exploring={exploring}
          locationDenied={locationDenied}
          onBackToNearMe={onBackToNearMe}
        />
      )}
    </LocationGate>
  );
}

function QuizBody({
  center,
  exploring,
  locationDenied,
  onBackToNearMe,
}: {
  center: Coordinates;
  exploring?: boolean;
  /** No real fix — the center is the fallback, not the user. */
  locationDenied?: boolean;
  onBackToNearMe?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { state } = useHistory(center);
  // `name` is the canonical article title everything keys on; `label` is
  // the spoken form, for display only (see use-area-name)
  const { name: areaName, label: areaLabel, settled: areaSettled } = useAreaName(center);

  const [phase, setPhase] = useState<Phase>('loading');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Lifted from the run: while a run is up the screen header stands
  // down, so a question and its options fit one screen (Edd's phone
  // finding, 2026-08-06 — the largeTitle pushed the run into a scroll)
  const [begun, setBegun] = useState(false);

  // The nearest dozen, and no more. The feed runs to ~100 stories in a
  // dense area and the server only ever reads twelve — sending all of
  // them made the route answer 413 "Body too large" and the tab said
  // "Couldn't set the quiz right now" in Deptford, on a phone, while the
  // route itself tested clean against a hand-made twelve.
  const stories =
    state.status === 'ready'
      ? state.items
          .filter((item) => item.extract?.trim())
          .slice(0, QuizStories)
          .map((item) => ({
            pageId: item.pageId,
            title: item.title,
            extract: item.extract as string,
          }))
      : null;

  // With location denied the center is the FALLBACK — central London —
  // not the reader. A quiz about Charing Cross, served without comment to
  // someone in Cupertino who tapped "Not now", is nonsense wearing a
  // straight face (and denying location is the first thing an App Review
  // reviewer does). Say what is needed instead, and spend nothing.
  // Exploring is different and stays: a pinned place is somewhere the
  // reader CHOSE, and quizzing it is the point of exploring.
  const denied = Boolean(locationDenied);

  // Ask only once BOTH have settled: before the area is named the quiz
  // would be keyed to a placeholder, and before the feed lands it would
  // be set from three stories when twelve were coming.
  //
  // The AREA is the ask, not its stories — the same identity the caches
  // on both sides of the wire now use (see quizCacheKey). Carrying the
  // pageIds here made every ~111m bucket crossing a new ask: the screen
  // tore down a running quiz, showed "Setting the questions…", and went
  // back for a quiz it already had (#280).
  const askKey = !denied && stories && areaSettled && areaName ? `${areaName}:${attempt}` : null;

  // Adjust-during-render (the Gazetteer's own pattern): walking into a
  // new area must not leave the last area's quiz on screen while its own
  // is being set.
  const [askedFor, setAskedFor] = useState<string | null>(null);
  if (askKey && askedFor !== askKey) {
    setAskedFor(askKey);
    setPhase('loading');
    setQuiz(null);
    // A new area's quiz opens on its start card, not mid-run
    setBegun(false);
  }

  useEffect(() => {
    if (!askKey || !areaName || !stories) {
      return;
    }
    let active = true;
    fetchQuiz(areaName, stories)
      .then((next) => {
        if (!active) {
          return;
        }
        setQuiz(next);
        setPhase(next ? 'ready' : 'none');
      })
      .catch(() => {
        if (active) {
          setPhase('error');
        }
      });
    return () => {
      active = false;
    };
    // askKey carries the area and the retry count — the only things
    // that change what quiz this is. The stories ride along as material
    // and deliberately do not re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);

  // The pointing finale, derived here rather than served: the bearing is
  // measured from where the reader IS, and a bearing baked into a 30-day
  // area cache would be wrong the moment they moved.
  //
  // Only from a real fix. While exploring, the center is a place the
  // reader is NOT, and with location denied it is the fallback — asking
  // either of them to point at something would be asking them to point
  // from somewhere they are not standing (#208's rule).
  const pointing =
    state.status === 'ready' && !exploring && !locationDenied
      ? pointableStory(state.items, center)
      : null;

  // Settled with no name is an answer, not a wait: nowhere here has a
  // name to quiz you on
  const resolved = areaSettled && !areaName ? 'none' : phase;
  const retry = () => setAttempt((previous) => previous + 1);
  // The run carries its own compact header (area · count · progress);
  // the screen's title would only push it into a scroll
  const running = begun && !denied && resolved === 'ready' && Boolean(quiz);

  return (
    // ThemedView for the ground, SafeAreaView for the top edge — the
    // Nearby tab's own arrangement. Without the safe area the title drew
    // underneath the status bar clock (caught on Edd's phone); without
    // ThemedView the screen loses its themed background in dark mode.
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
          {/* A pinned place is a mode the header must admit, exactly as
              Nearby's does: accent eyebrow, and the worded way home. */}
          {!running && (
            <>
              <ThemedText type="eyebrow" themeColor={exploring ? 'accent' : 'textSecondary'}>
                {exploring ? 'Exploring · test yourself on' : 'Test yourself on'}
              </ThemedText>
              <ThemedText type="largeTitle">
                {denied ? 'wherever you are' : (areaLabel ?? 'this ground')}
              </ThemedText>
            </>
          )}

          {denied && (
            <View style={styles.centered} testID="quiz-denied">
              <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
                Venture sets its quiz from the history around you, so it needs your location —
                or a place searched on the Nearby tab.
              </ThemedText>
            </View>
          )}

          {!denied && resolved === 'loading' && (
            <View style={styles.centered} testID="quiz-loading">
              <ActivityIndicator color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary">
                Setting the questions…
              </ThemedText>
            </View>
          )}

          {!denied && resolved === 'error' && (
            <View style={styles.centered} testID="quiz-error">
              <ThemedText type="small" themeColor="textSecondary">
                Couldn’t set the quiz right now.
              </ThemedText>
              <Pressable accessibilityRole="button" testID="quiz-retry" onPress={retry}>
                <ThemedText type="linkPrimary">Try again</ThemedText>
              </Pressable>
            </View>
          )}

          {/* The floor: too little recorded history here to ask about it
              honestly. Words and a wander line, the same answer the empty
              feed gives — never a blank tab. */}
          {!denied && resolved === 'none' && (
            <View style={styles.centered} testID="quiz-none">
              <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
                Not enough recorded history right here to set a quiz. Wander a little, or look
                somewhere with more of it.
              </ThemedText>
            </View>
          )}

          {exploring && !running && (
            <Pressable
              accessibilityRole="button"
              testID="quiz-back-to-near-me"
              onPress={onBackToNearMe}
              hitSlop={Spacing.two}>
              <ThemedText type="linkPrimary">Back to near me</ThemedText>
            </Pressable>
          )}

          {!denied && resolved === 'ready' && quiz && (
            <QuizGuard onRetry={retry}>
              <QuizRun
                quiz={quiz}
                pointing={pointing}
                areaLabel={denied ? null : areaLabel}
                begun={begun}
                onBegin={() => setBegun(true)}
                key={quiz.areaName}
              />
            </QuizGuard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    gap: Spacing.one,
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.four * 2,
  },
  emptyCopy: {
    textAlign: 'center',
  },
});
