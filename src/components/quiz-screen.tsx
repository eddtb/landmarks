import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

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

/**
 * The quiz tab: five questions about the ground you are standing on,
 * set by the app from the stories it found there.
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

export function QuizScreen() {
  return (
    <LocationGate>
      {({ center }) => <QuizBody center={center} />}
    </LocationGate>
  );
}

function QuizBody({ center }: { center: Coordinates }) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { state } = useHistory(center);
  // `name` is the canonical article title everything keys on; `label` is
  // the spoken form, for display only (see use-area-name)
  const { name: areaName, label: areaLabel, settled: areaSettled } = useAreaName(center);

  const [phase, setPhase] = useState<Phase>('loading');
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState(0);

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

  // Ask only once BOTH have settled: before the area is named the quiz
  // would be keyed to a placeholder, and before the feed lands it would
  // be set from three stories when twelve were coming.
  const askKey =
    stories && areaSettled && areaName
      ? `${areaName}:${stories.map((story) => story.pageId).join(',')}:${attempt}`
      : null;

  // Adjust-during-render (the Gazetteer's own pattern): walking into a
  // new area must not leave the last area's quiz on screen while its own
  // is being set.
  const [askedFor, setAskedFor] = useState<string | null>(null);
  if (askKey && askedFor !== askKey) {
    setAskedFor(askKey);
    setPhase('loading');
    setQuiz(null);
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
    // askKey carries the area and its stories — the only things that
    // change what quiz this is
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askKey]);

  // Settled with no name is an answer, not a wait: nowhere here has a
  // name to quiz you on
  const resolved = areaSettled && !areaName ? 'none' : phase;
  const retry = () => setAttempt((previous) => previous + 1);

  return (
    // ThemedView for the ground, SafeAreaView for the top edge — the
    // Nearby tab's own arrangement. Without the safe area the title drew
    // underneath the status bar clock (caught on Edd's phone); without
    // ThemedView the screen loses its themed background in dark mode.
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + insets.bottom }]}>
          <ThemedText type="eyebrow" themeColor="textSecondary">
            Test yourself on
          </ThemedText>
          <ThemedText type="largeTitle">{areaLabel ?? 'this ground'}</ThemedText>

          {resolved === 'loading' && (
            <View style={styles.centered} testID="quiz-loading">
              <ActivityIndicator color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary">
                Setting the questions…
              </ThemedText>
            </View>
          )}

          {resolved === 'error' && (
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
          {resolved === 'none' && (
            <View style={styles.centered} testID="quiz-none">
              <WanderLine arcSpan={52} stroke={6} count={4} color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary" style={styles.emptyCopy}>
                Not enough recorded history right here to set a quiz. Wander a little, or look
                somewhere with more of it.
              </ThemedText>
            </View>
          )}

          {resolved === 'ready' && quiz && <QuizRun quiz={quiz} key={quiz.areaName} />}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

/** The run itself: one question at a time, the fact after each answer. */
function QuizRun({ quiz }: { quiz: Quiz }) {
  const theme = useTheme();
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [score, setScore] = useState(0);

  const question = quiz.questions[index];
  const last = index === quiz.questions.length - 1;
  const answered = chosen !== null;

  if (!question) {
    // Finished: the score, and the way round again
    return (
      <View style={styles.run} testID="quiz-done">
        <ThemedText type="headline">
          {score} out of {quiz.questions.length}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {score === quiz.questions.length
            ? 'Every one. You know this ground.'
            : 'The stories behind these are all within a walk.'}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          testID="quiz-again"
          onPress={() => {
            setIndex(0);
            setChosen(null);
            setScore(0);
          }}>
          <ThemedText type="linkPrimary">Go again</ThemedText>
        </Pressable>
      </View>
    );
  }

  const choose = (option: number) => {
    if (answered) {
      return;
    }
    setChosen(option);
    if (option === question.answerIndex) {
      setScore((previous) => previous + 1);
    }
  };

  return (
    <View style={styles.run} testID="quiz-run">
      <ThemedText type="small" themeColor="textSecondary">
        Question {index + 1} of {quiz.questions.length}
      </ThemedText>
      <ThemedText type="subtitle">{question.question}</ThemedText>

      {question.options.map((option, option_index) => {
        const right = option_index === question.answerIndex;
        // Only once answered does the sheet say anything about which is
        // which — a colour before the tap would give it away
        const tint = answered && right ? theme.accentSoft : theme.backgroundElement;
        return (
          <Pressable
            key={option_index}
            accessibilityRole="button"
            // Words, not colour alone (PR #186): the state is spoken
            accessibilityLabel={
              answered
                ? `${option}. ${right ? 'Correct answer' : option_index === chosen ? 'Your answer, wrong' : 'Not the answer'}`
                : option
            }
            disabled={answered}
            testID={`quiz-option-${option_index}`}
            onPress={() => choose(option_index)}
            style={({ pressed }) => [
              styles.option,
              { backgroundColor: tint },
              answered && right && { borderColor: theme.accent, borderWidth: 2 },
              pressed && { opacity: 0.85 },
            ]}>
            <ThemedText type={answered && right ? 'smallBold' : 'small'}>{option}</ThemedText>
          </Pressable>
        );
      })}

      {answered && (
        <View style={styles.because} testID="quiz-because">
          <ThemedText type="smallBold" themeColor={chosen === question.answerIndex ? 'accent' : 'textSecondary'}>
            {chosen === question.answerIndex ? 'Right.' : 'Not this time.'}
          </ThemedText>
          <ThemedText type="small">{question.because}</ThemedText>
          {/* The citation IS the invitation — go and read it */}
          <Pressable
            accessibilityRole="button"
            testID="quiz-source"
            onPress={() =>
              router.push({
                pathname: '/history/[pageId]',
                params: { pageId: String(question.pageId) },
              })
            }>
            <ThemedText type="linkPrimary">Read {question.title} ›</ThemedText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            testID="quiz-next"
            onPress={() => {
              setIndex((previous) => previous + 1);
              setChosen(null);
            }}>
            <ThemedText type="linkPrimary">{last ? 'See the score' : 'Next question'}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
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
  run: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  option: {
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  because: {
    gap: Spacing.two,
    paddingTop: Spacing.two,
  },
});
