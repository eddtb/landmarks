import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { QuizDirection } from '@/components/quiz-direction';
import { ThemedText } from '@/components/themed-text';
import { BrandWarmInk, Colors, Radius, Spacing } from '@/constants/theme';
import { orderedByYear } from '@/data/quiz-client';
import { Ranks, rankFor, recordRun, useAreaProgress } from '@/data/quiz-progress';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { OrderQuestion, Quiz, QuizQuestion } from '@/types/quiz';
import { DirectionQuestion } from '@/utils/quiz-direction';

/**
 * The run: the approved v1 design (mock round, 2026-08-06). One
 * question at a time in four registers — anchor, which-place, order,
 * true-or-myth — with the pointing finale closing every run that has
 * one, because it is the only question that asks anything of the room
 * you are standing in.
 *
 * State is words and dimming, never colour (the palette rule, held even
 * here): a reveal dims the wrong options and SAYS which is which. No
 * green, no red. The one extravagance is the perfect-run banner, which
 * wears the warm accent — its third sanctioned use, see theme.ts.
 *
 * Answering is two taps — choose, then lock — so a stray thumb on a
 * list of answers is not an answer. Every reveal cites its story, and
 * the citation is the tap target: the quiz's real job is opening them.
 */

type RunResult = { label: string; right: boolean; pageId: number };

/**
 * The run's three surfaces. Two of them are things you BROWSE and wear
 * the tab's island; the middle one is the app asking, and owns the
 * screen alone (direction B, #300).
 */
export type RunStage = 'start' | 'question' | 'results';

/** What the reveal says instead of colouring. */
const RightChosen = 'Right — you chose this';
const RightNotChosen = 'The answer';
const WrongChosen = 'Your answer';

export function QuizRun({
  quiz,
  pointing,
  areaLabel,
  begun,
  onBegin,
  onStage,
}: {
  quiz: Quiz;
  pointing: DirectionQuestion | null;
  /** The spoken form for the run's compact eyebrow — the big screen
   *  header leaves when the run begins, so everything fits one screen. */
  areaLabel: string | null;
  begun: boolean;
  onBegin: () => void;
  /** Which of the three surfaces is up, so the screen can stand its
   *  island down for a question and back up for the results. `begun`
   *  cannot answer it: it stays true through the results. */
  onStage?: (stage: RunStage) => void;
}) {
  const [index, setIndex] = useState(0);
  const [results, setResults] = useState<RunResult[]>([]);

  const written = quiz.questions.length;
  const total = written + (pointing ? 1 : 0);
  const question = quiz.questions[index];

  const advance = (result: RunResult) => {
    setResults((previous) => [...previous, result]);
    setIndex((previous) => previous + 1);
  };

  // Declared before the returns below, which is what keeps the report
  // honest: every surface this component can render is named here once.
  const stage: RunStage = !begun
    ? 'start'
    : question || (pointing && index === written)
      ? 'question'
      : 'results';
  useEffect(() => {
    onStage?.(stage);
  }, [stage, onStage]);

  if (!begun) {
    return <StartCard quiz={quiz} total={total} onBegin={onBegin} />;
  }

  if (question) {
    return (
      <View style={styles.run} testID="quiz-run">
        <Progress label={areaLabel} index={index} total={total} />
        {question.kind === 'order' ? (
          <OrderBody key={index} question={question} onDone={advance} />
        ) : (
          <OptionsBody key={index} question={question} onDone={advance} />
        )}
      </View>
    );
  }

  if (pointing && index === written) {
    return (
      <View style={styles.run} testID="quiz-run">
        <Progress label={areaLabel} index={index} total={total} />
        <QuizDirection
          question={pointing}
          last
          onAnswered={(correct) =>
            advance({ label: `Point at ${pointing.title}`, right: correct, pageId: pointing.pageId })
          }
        />
      </View>
    );
  }

  const score = results.filter((result) => result.right).length;
  return (
    <Results
      areaName={quiz.areaName}
      score={score}
      total={total}
      results={results}
      onAgain={() => {
        setIndex(0);
        setResults([]);
      }}
    />
  );
}

/**
 * The start card: the grounding contract worn on the outside. The chips
 * name the exact stories this run was set from — no general knowledge,
 * nothing beyond a short walk.
 */
function StartCard({
  quiz,
  total,
  onBegin,
}: {
  quiz: Quiz;
  total: number;
  onBegin: () => void;
}) {
  const theme = useTheme();
  const titles = [...new Set(quiz.questions.flatMap(storyTitles))];
  return (
    <View style={styles.run} testID="quiz-start">
      <View style={[styles.startCard, { backgroundColor: theme.backgroundElement }]}>
        <ThemedText type="eyebrow" themeColor="accent">
          {total === 1 ? 'One question' : `${spelt(total)} questions`} · set from its own stories
        </ThemedText>
        <ThemedText type="small">
          No general knowledge. Everything asked here is in a story within a short walk of where
          you stand.
        </ThemedText>
        <View style={styles.chips}>
          {titles.map((title) => (
            <View key={title} style={[styles.chip, { borderColor: theme.backgroundSelected }]}>
              <ThemedText type="small" themeColor="textSecondary">
                {title}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>
      <PillButton label="Begin" testID="quiz-begin" onPress={onBegin} />
    </View>
  );
}

function storyTitles(question: QuizQuestion): string[] {
  return question.kind === 'order' ? question.items.map((item) => item.title) : [question.title];
}

/** "Six", not "6": the start card speaks, the score screen counts. */
function spelt(count: number): string {
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
  return words[count] ?? String(count);
}

/** The run's whole header: area, count, and the progress bar — the
 *  compact stand-in for the screen title while a run is up.
 *
 *  ONE progress idiom (direction B, #300). Six segments used to say
 *  here what a 4pt accent-on-accentSoft bar says on every reading
 *  screen, so the app had two ways of drawing the same fact. The bar
 *  won because it is the one that scales: it reads identically at six
 *  questions and at three, which the segments did not. */
function Progress({
  label,
  index,
  total,
}: {
  label: string | null;
  index: number;
  total: number;
}) {
  const theme = useTheme();
  return (
    <View style={styles.progressBlock}>
      <View style={[styles.progress, { backgroundColor: theme.accentSoft }]} testID="quiz-progress">
        <View
          style={[
            styles.progressFill,
            { backgroundColor: theme.accent, width: `${(index / total) * 100}%` },
          ]}
        />
      </View>
      <View style={styles.progressWords}>
        {label && (
          <ThemedText type="eyebrow" themeColor="accent">
            {label}
          </ThemedText>
        )}
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {index + 1} of {total}
        </ThemedText>
      </View>
    </View>
  );
}

/**
 * Anchor, which-place and true-or-myth are one interaction: options,
 * choose, lock, reveal. True-or-myth simply has two options whose order
 * is fixed — truth cannot be dealt.
 */
function OptionsBody({
  question,
  onDone,
}: {
  question: Exclude<QuizQuestion, OrderQuestion>;
  onDone: (result: RunResult) => void;
}) {
  const theme = useTheme();
  const [chosen, setChosen] = useState<number | null>(null);
  const [locked, setLocked] = useState(false);

  const text = question.kind === 'true-false' ? question.statement : question.question;
  const options = question.kind === 'true-false' ? ['True here', 'A myth'] : question.options;
  const answerIndex = question.kind === 'true-false' ? (question.answer ? 0 : 1) : question.answerIndex;
  const right = chosen === answerIndex;

  return (
    <>
      <ThemedText type="title">
        {text}
      </ThemedText>
      {options.map((option, optionIndex) => {
        const isAnswer = optionIndex === answerIndex;
        const isChosen = optionIndex === chosen;
        const verdict = !locked ? null : isAnswer ? (isChosen ? RightChosen : RightNotChosen) : isChosen ? WrongChosen : null;
        return (
          <Pressable
            key={optionIndex}
            accessibilityRole="button"
            // Words, not colour alone (PR #186): the state is spoken
            accessibilityLabel={verdict ? `${option}. ${verdict}` : option}
            disabled={locked}
            testID={`quiz-option-${optionIndex}`}
            onPress={() => setChosen(optionIndex)}
            style={({ pressed }) => [
              styles.option,
              { borderColor: theme.backgroundSelected },
              isChosen && !locked && { borderColor: theme.accent, backgroundColor: theme.accentSoft },
              locked && isAnswer && { borderColor: theme.accent, backgroundColor: theme.accentSoft },
              // The rule: wrong answers dim, they never redden
              locked && !isAnswer && { opacity: 0.45 },
              pressed && { opacity: 0.85 },
            ]}>
            {verdict && (
              <ThemedText
                type="eyebrow"
                themeColor={isAnswer ? 'accent' : 'textSecondary'}
                testID={isAnswer ? 'quiz-verdict-right' : 'quiz-verdict-wrong'}>
                {verdict}
              </ThemedText>
            )}
            <ThemedText type={locked && isAnswer ? 'smallBold' : 'small'}>{option}</ThemedText>
            {locked && isAnswer && (
              <ThemedText type="small" themeColor="textSecondary">
                {question.because}
              </ThemedText>
            )}
          </Pressable>
        );
      })}
      {!locked && (
        <PillButton
          label="Lock it in"
          testID="quiz-lock"
          disabled={chosen === null}
          onPress={() => setLocked(true)}
        />
      )}
      {locked && (
        <Reveal
          pageId={question.pageId}
          title={question.title}
          onNext={() => onDone({ label: question.title, right, pageId: question.pageId })}
        />
      )}
    </>
  );
}

/**
 * Order the ground: tap the places oldest-first — each tap takes the
 * next number, tapping a numbered card clears from it onwards. Chosen
 * over a drag for v1: the interaction is one thumb, fully testable, and
 * spends no worklet (the quiz has crashed on a missing 'worklet' before
 * — see QuizGuard).
 */
function OrderBody({
  question,
  onDone,
}: {
  question: OrderQuestion;
  onDone: (result: RunResult) => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<number[]>([]);
  const [locked, setLocked] = useState(false);

  const answer = orderedByYear(question.items);
  const right =
    picked.length === answer.length &&
    picked.every((itemIndex, position) => question.items[itemIndex].pageId === answer[position].pageId);

  const tap = (itemIndex: number) => {
    // Functional, not a closure over `picked`: three fast taps must
    // compose even if no render commits between them
    setPicked((current) => {
      const position = current.indexOf(itemIndex);
      // A numbered card un-picks itself and everything after it
      return position === -1 ? [...current, itemIndex] : current.slice(0, position);
    });
  };

  return (
    <>
      <ThemedText type="title">
        {question.question}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Tap them oldest first.
      </ThemedText>
      {question.items.map((item, itemIndex) => {
        const position = picked.indexOf(itemIndex);
        const answerPosition = locked
          ? answer.findIndex((entry) => entry.pageId === item.pageId)
          : -1;
        const rightHere = locked && position === answerPosition;
        return (
          <Pressable
            key={item.pageId}
            accessibilityRole="button"
            accessibilityLabel={
              locked
                ? `${item.title}, ${item.year}. ${rightHere ? 'Placed right' : `Belongs ${ordinal(answerPosition + 1)}`}`
                : position === -1
                  ? item.title
                  : `${item.title}, picked ${ordinal(position + 1)}`
            }
            disabled={locked}
            testID={`quiz-order-item-${itemIndex}`}
            onPress={() => tap(itemIndex)}
            style={({ pressed }) => [
              styles.option,
              styles.orderCard,
              { borderColor: theme.backgroundSelected },
              position !== -1 && !locked && { borderColor: theme.accent },
              locked && !rightHere && { opacity: 0.45 },
              locked && rightHere && { borderColor: theme.accent, backgroundColor: theme.accentSoft },
              pressed && { opacity: 0.85 },
            ]}>
            <View
              style={[
                styles.orderBadge,
                { backgroundColor: position !== -1 ? theme.accentSoft : theme.backgroundElement },
              ]}>
              <ThemedText type="smallBold" themeColor={position !== -1 ? 'accent' : 'textSecondary'}>
                {position !== -1 ? String(position + 1) : '·'}
              </ThemedText>
            </View>
            <View style={styles.orderWords}>
              <ThemedText type="small">{item.title}</ThemedText>
              {/* The dates arrive in the reveal — the reasoning is
                  architectural, not memorised */}
              {locked && (
                <ThemedText type="small" themeColor="textSecondary">
                  {item.year}
                </ThemedText>
              )}
            </View>
          </Pressable>
        );
      })}
      {locked && (
        <ThemedText type="eyebrow" themeColor={right ? 'accent' : 'textSecondary'} testID="quiz-order-verdict">
          {right ? 'Right — oldest first' : 'Not that order'}
        </ThemedText>
      )}
      {locked && (
        <ThemedText type="small" themeColor="textSecondary">
          {question.because}
        </ThemedText>
      )}
      {!locked && (
        <PillButton
          label="Lock it in"
          testID="quiz-lock"
          disabled={picked.length !== question.items.length}
          onPress={() => setLocked(true)}
        />
      )}
      {locked && (
        <Reveal
          pageId={question.pageId}
          title={question.title}
          onNext={() => onDone({ label: question.title, right, pageId: question.pageId })}
        />
      )}
    </>
  );
}

function ordinal(position: number): string {
  return position === 1 ? 'first' : position === 2 ? 'second' : position === 3 ? 'third' : `${position}th`;
}

/** The door back in, and the way on. */
function Reveal({ pageId, title, onNext }: { pageId: number; title: string; onNext: () => void }) {
  return (
    <>
      {/* The citation IS the invitation — go and read it */}
      <Pressable
        accessibilityRole="button"
        testID="quiz-source"
        onPress={() =>
          router.push({ pathname: '/history/[pageId]', params: { pageId: String(pageId) } })
        }>
        <ThemedText type="linkPrimary">Read the story — {title} ›</ThemedText>
      </Pressable>
      <PillButton label="Next" testID="quiz-next" onPress={onNext} />
    </>
  );
}

/**
 * The score, the ladder, and the doors back into every story asked
 * about. Ranks are per-area and cumulative — Greenwich remembers you —
 * and a perfect run earns the warm banner (see theme.ts: sanctioned
 * use three).
 */
function Results({
  areaName,
  score,
  total,
  results,
  onAgain,
}: {
  areaName: string;
  score: number;
  total: number;
  results: RunResult[];
  onAgain: () => void;
}) {
  const theme = useTheme();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const progress = useAreaProgress(areaName);
  const rank = rankFor(progress?.correct ?? score);
  const perfect = score === total;

  // On mount, exactly once per finished run: "Another round" unmounts
  // this screen, so the next completion records itself again. An effect,
  // not a render-time call — recording writes to disk.
  useEffect(() => {
    recordRun(areaName, score, total);
    // A results screen shows ONE finished run — none of these change
    // while it is on screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.run} testID="quiz-done">
      <View style={styles.scoreHero}>
        <ThemedText type="largeTitle" maxFontSizeMultiplier={1.4}>
          {score} of {total}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {perfect ? 'every one' : 'the stories behind these are all within a walk'}
        </ThemedText>
      </View>

      {perfect && (
        <View
          testID="quiz-perfect"
          style={[styles.warmBanner, { backgroundColor: Colors[scheme].warmSoft }]}>
          <ThemedText
            type="smallBold"
            style={{ color: scheme === 'light' ? BrandWarmInk : Colors.dark.accentWarm }}>
            A perfect run on this ground.
          </ThemedText>
        </View>
      )}

      <View style={styles.rankRow} testID="quiz-rank">
        {Ranks.map((step) => {
          const current = step === rank;
          return (
            <View
              key={step}
              testID={current ? 'quiz-rank-current' : undefined}
              style={[
                styles.rankChip,
                { backgroundColor: current ? theme.accent : theme.backgroundElement },
              ]}>
              <ThemedText
                type="eyebrow"
                style={current ? { color: theme.background } : undefined}
                themeColor={current ? undefined : 'textSecondary'}>
                {step}
              </ThemedText>
            </View>
          );
        })}
      </View>

      {results.map((result, resultIndex) => (
        <Pressable
          key={resultIndex}
          accessibilityRole="button"
          testID={`quiz-result-${resultIndex}`}
          onPress={() =>
            router.push({
              pathname: '/history/[pageId]',
              params: { pageId: String(result.pageId) },
            })
          }
          style={[styles.resultRow, { borderTopColor: theme.backgroundElement }]}>
          <ThemedText
            type="eyebrow"
            themeColor={result.right ? 'accent' : 'textSecondary'}
            style={styles.resultWord}>
            {result.right ? 'Right' : 'Missed'}
          </ThemedText>
          <ThemedText type="small" style={styles.resultTitle} numberOfLines={1}>
            {result.label}
          </ThemedText>
          <ThemedText type="small" themeColor="accent">
            Story ›
          </ThemedText>
        </Pressable>
      ))}

      <PillButton label="Another round, same ground" testID="quiz-again" onPress={onAgain} />
    </View>
  );
}

/** The one interactive colour, worn as the one button shape. */
function PillButton({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: theme.accent },
        disabled && { opacity: 0.35 },
        pressed && { opacity: 0.85 },
      ]}>
      <ThemedText type="smallBold" style={{ color: theme.background }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  run: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  // The question wears the `title` tier bare — the run must fit one
  // screen with its options and button (Edd's phone finding), and the
  // voice is the app's one sans (type policy, mocked and decided)
  startCard: {
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingTop: Spacing.one,
  },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  progressBlock: {
    gap: Spacing.two,
  },
  progressWords: {
    flexDirection: 'row',
    gap: Spacing.two,
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  // The reading bar's exact track: 4pt, thick enough to register at a
  // glance, thin enough to stay a bar and not a banner
  progress: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 4,
  },
  option: {
    gap: Spacing.one,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    borderWidth: 2,
  },
  orderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
  },
  orderBadge: {
    width: Spacing.four,
    height: Spacing.four,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orderWords: {
    flex: 1,
    gap: Spacing.half,
  },
  pill: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.pill,
    marginTop: Spacing.two,
  },
  scoreHero: {
    alignItems: 'center',
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  warmBanner: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    alignItems: 'center',
  },
  rankRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  rankChip: {
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
    paddingVertical: Spacing.two,
    borderTopWidth: 1,
  },
  resultWord: {
    width: Spacing.six,
  },
  resultTitle: {
    flex: 1,
  },
});
