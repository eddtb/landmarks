import { Component, ReactNode, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassIslandHeader, IslandTitle, useIslandInset } from '@/components/glass-header';
import { failureCause, FailureCause, LoadFailure } from '@/components/load-failure';
import { QuizRun, RunStage } from '@/components/quiz-run';
import { LocationGate } from '@/components/section-screen';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { WanderLine } from '@/components/wander-line';
import { Spacing } from '@/constants/theme';
import { fetchQuiz } from '@/data/quiz-client';
import { loadVerdict } from '@/data/load-verdict';
import { rankFor, useAreaProgress } from '@/data/quiz-progress';
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
      {({ center, exploring, onBackToNearMe }) => (
        <QuizBody center={center} exploring={exploring} onBackToNearMe={onBackToNearMe} />
      )}
    </LocationGate>
  );
}

function QuizBody({
  center,
  exploring,
  onBackToNearMe,
}: {
  /** Null when there is no honest centre — no fix and no pin. */
  center: Coordinates | null;
  exploring?: boolean;
  onBackToNearMe?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { state } = useHistory(center);
  // `name` is the canonical article title everything keys on; `label` is
  // the spoken form, for display only (see use-area-name)
  const { name: areaName, label: areaLabel, settled: areaSettled } = useAreaName(center);

  const [phase, setPhase] = useState<Phase>('loading');
  // What broke, when phase is 'error': the panel says whether an answer
  // came back an error or never came back at all (#291).
  const [failure, setFailure] = useState<FailureCause>('silent');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Lifted from the run: while a run is up the screen header stands
  // down, so a question and its options fit one screen (Edd's phone
  // finding, 2026-08-06 — the largeTitle pushed the run into a scroll)
  const [begun, setBegun] = useState(false);
  // Which of the run's three surfaces is up. The start card and the
  // results are surfaces you BROWSE, so the island stands on both; a
  // question is the app asking, the one place it does, so the chrome
  // stands down and the question owns the screen (direction B, #300).
  // `begun` cannot answer this on its own — it stays true through the
  // results, which are a surface again.
  const [stage, setStage] = useState<RunStage>('start');
  const [islandHeight, setIslandHeight] = useState(96);

  // No centre, no quiz. A quiz about Charing Cross, served without
  // comment to someone in Cupertino who tapped "Not now", is nonsense
  // wearing a straight face (and denying location is the first thing
  // an App Review reviewer does). Say what is needed instead, and
  // spend nothing. Exploring is different and stays: a pinned place is
  // somewhere the reader CHOSE, and quizzing it is the point of it.
  //
  // It is also the route's own precondition now: /api/quiz takes two
  // finite numbers and nothing else (#303), so a null centre is not a
  // degraded ask, it is no ask at all.
  const denied = center === null;

  // Ask once the area has settled, and not before: the name is what the
  // quiz is cached under, so asking early would key it to a placeholder.
  // It no longer waits for the feed — the stories are the server's to
  // find now (#303), so a slow feed only delays the pointing finale.
  const askKey = !denied && areaSettled && areaName ? `${areaName}:${attempt}` : null;

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
    setStage('start');
  }

  useEffect(() => {
    // center is non-null wherever askKey is (see `denied`), but the ask
    // says so itself rather than leaning on that: the route's contract
    // is two finite numbers, and this is where they are handed over.
    if (!askKey || !areaName || !center) {
      return;
    }
    let active = true;
    fetchQuiz(areaName, center)
      .then((next) => {
        if (!active) {
          return;
        }
        setQuiz(next);
        setPhase(next ? 'ready' : 'none');
      })
      .catch((error: unknown) => {
        if (active) {
          setFailure(failureCause(loadVerdict(error)));
          setPhase('error');
        }
      });
    return () => {
      active = false;
    };
    // askKey carries the area — the only thing that changes what quiz
    // this is. The center rides along to name the ground to the server,
    // and deliberately does NOT re-trigger: a few paces is the same
    // area, and the same quiz (#280).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);

  // The pointing finale, derived here rather than served: the bearing is
  // measured from where the reader IS, and a bearing baked into a 30-day
  // area cache would be wrong the moment they moved.
  //
  // Only from a real fix. While exploring, the center is a place the
  // reader is NOT, and with no centre there is nowhere to point from —
  // asking either to point at something would be asking them to point
  // from somewhere they are not standing (#208's rule).
  const pointing =
    state.status === 'ready' && !exploring && center !== null
      ? pointableStory(state.items, center)
      : null;

  // Settled with no name is an answer, not a wait: nowhere here has a
  // name to quiz you on
  const resolved = areaSettled && !areaName ? 'none' : phase;
  const retry = () => setAttempt((previous) => previous + 1);
  // The run carries its own compact header (area · count · progress);
  // the screen's title would only push it into a scroll
  const running = begun && !denied && resolved === 'ready' && Boolean(quiz);
  // An island either stands or arrives (DESIGN.md, Glass). This one
  // stands — the quiz tab's title is the screen's own — and stands DOWN
  // for a question, which is the 2026-08-06 phone finding made into a
  // rule instead of a special case: the run needs that ~80pt.
  const islandStands = !(running && stage === 'question');
  const islandInset = useIslandInset(islandHeight);

  return (
    // ThemedView for the ground; the island pays the top edge for the
    // whole screen (useIslandInset), so the SafeAreaView keeps only the
    // horizontal ones. Without ThemedView the screen loses its themed
    // background in dark mode.
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['left', 'right']}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              // Chrome-less mid-question: the content takes the notch
              // back and keeps the height an island would have spent.
              paddingTop: islandStands ? islandInset : insets.top + Spacing.two,
              paddingBottom: Spacing.four + insets.bottom,
            },
          ]}>

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
            <View style={styles.failure} testID="quiz-error">
              <LoadFailure surface="quiz" cause={failure} onRetry={retry} />
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

          {!denied && resolved === 'ready' && quiz && (
            <QuizGuard onRetry={retry}>
              <QuizRun
                quiz={quiz}
                pointing={pointing}
                areaLabel={denied ? null : areaLabel}
                begun={begun}
                onBegin={() => setBegun(true)}
                onStage={setStage}
                key={quiz.areaName}
              />
            </QuizGuard>
          )}
        </ScrollView>
      </SafeAreaView>
      {/* After the body so it paints above, and a DIRECT child of the
          screen surface — the one arrangement useIslandInset assumes. */}
      {islandStands && (
        <GlassIslandHeader onHeight={setIslandHeight}>
          <View style={styles.island} testID="quiz-island">
            {/* A pinned place is a mode the chrome must admit, exactly
                as Nearby's does: accent eyebrow, and the worded way
                home. The eyebrow is the TAB's name — the nameplate
                grammar wants it there, and the start card already says
                what the run is. */}
            <ThemedText type="eyebrow" themeColor={exploring ? 'accent' : 'textSecondary'}>
              {exploring ? 'Exploring · Quiz' : 'Quiz'}
            </ThemedText>
            <IslandTitle
              title={denied ? 'wherever you are' : (areaLabel ?? 'this ground')}
              hollow={Boolean(exploring) || denied}
            />
            <QuizStanding areaName={areaName} />
            {exploring && (
              <Pressable
                accessibilityRole="button"
                testID="quiz-back-to-near-me"
                onPress={onBackToNearMe}
                hitSlop={Spacing.two}>
                <ThemedText type="linkPrimary">Back to near me</ThemedText>
              </Pressable>
            )}
          </View>
        </GlassIslandHeader>
      )}
    </ThemedView>
  );
}

/**
 * The island's status line: your standing on this ground, not this
 * run's score. DESIGN.md's rule for the line under an island title is
 * that it is the screen's STATUS line — Nearby's count, History's
 * relics, and here the rank the ground remembers.
 */
function QuizStanding({ areaName }: { areaName: string | null }) {
  const progress = useAreaProgress(areaName ?? '');
  const correct = progress?.correct ?? 0;
  const rank = rankFor(correct);
  return (
    <ThemedText type="small" themeColor="textSecondary" testID="quiz-standing">
      {correct > 0 ? `${rank} · ${correct} right on this ground` : `${rank} · no answers here yet`}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.one,
  },
  island: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.three - 4,
    gap: Spacing.half,
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
  // The screen already pads its content; the panel's own margins would
  // double it, so this cancels them back out
  failure: {
    marginHorizontal: -Spacing.four,
    paddingTop: Spacing.three,
  },
});
