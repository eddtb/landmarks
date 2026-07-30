import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useShortestArc } from '@/components/pointer-dial';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useHeadingValue } from '@/hooks/use-heading';
import { useTheme } from '@/hooks/use-theme';
import { formatWalkTimeForMeters } from '@/utils/format';
import { compassWords } from '@/utils/geo';
import {
  DirectionQuestion,
  DirectionToleranceDegrees,
  headingError,
  pointedCorrectly,
} from '@/utils/quiz-direction';

/**
 * The quiz's last question, and the only one that asks the device
 * anything: turn until you are facing the place, then say so.
 *
 * Deliberately NO needle to the target — PointerDial exists for that and
 * would hand over the answer. The card rotates so north stays pinned to
 * the world and a fixed mark at the top shows where you are facing; what
 * you know, and the turning, is the whole question.
 *
 * The heading arrives as a SharedValue rather than React state (see
 * use-heading: the sensor ticks tens of times a second), so it is read
 * once, on the press, and never renders anything per tick.
 */

const DialSize = 210;

export function QuizDirection({
  question,
  onAnswered,
  last,
}: {
  question: DirectionQuestion;
  onAnswered: (correct: boolean) => void;
  last: boolean;
}) {
  const theme = useTheme();
  const { heading, available } = useHeadingValue(true);
  const [guess, setGuess] = useState<number | null>(null);

  // North pinned to the world, so the card counter-rotates under a fixed
  // mark — the same treatment the compass dial gives its cardinal card.
  //
  // The 'worklet' directive is load-bearing, not decoration: this runs on
  // the UI thread inside useAnimatedReaction, and without the directive
  // the first magnetometer tick after mount calls an uncompiled function
  // there — which is a CRASH in a release build. That is what killed the
  // quiz on Edd's phone at the pointing question, four questions in.
  // Jest runs worklets as plain JS and no simulator has a magnetometer,
  // so no test or sim pass could ever have caught it: every callback
  // handed to useShortestArc must carry the directive, as PointerDial's
  // own all do.
  const cardStyle = useShortestArc(heading, (degrees) => {
    'worklet';
    return available ? (360 - degrees) % 360 : null;
  });

  // No magnetometer (a simulator, or an older device): say so plainly and
  // let the quiz finish rather than trapping the reader on a dead question
  if (!available) {
    return (
      <View style={styles.block} testID="quiz-direction-unavailable">
        <ThemedText type="small" themeColor="textSecondary">
          This last one needs a compass, and this device doesn’t have one.
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          testID="quiz-direction-skip"
          onPress={() => onAnswered(false)}>
          <ThemedText type="linkPrimary">{last ? 'See the score' : 'Next question'}</ThemedText>
        </Pressable>
      </View>
    );
  }

  const error = guess === null ? null : headingError(guess, question.bearing);
  const right = guess !== null && pointedCorrectly(guess, question.bearing);

  return (
    <View style={styles.block} testID="quiz-direction">
      <ThemedText type="subtitle">Which way is {question.title}?</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        About {formatWalkTimeForMeters(question.distanceMeters)} away — turn until you’re facing it.
      </ThemedText>

      <View style={styles.dialWrap}>
        {/* Where you are facing: fixed, outside the rotating card */}
        <View style={[styles.facing, { backgroundColor: theme.accent }]} />
        <Animated.View
          style={[styles.dial, { borderColor: theme.backgroundElement }, cardStyle]}
          accessibilityLabel="Compass card">
          {(['N', 'E', 'S', 'W'] as const).map((point, index) => (
            <View
              key={point}
              style={[styles.cardinal, { transform: [{ rotate: `${index * 90}deg` }] }]}>
              <ThemedText type="smallBold" themeColor={point === 'N' ? 'accent' : 'textSecondary'}>
                {point}
              </ThemedText>
            </View>
          ))}
        </Animated.View>
      </View>

      {guess === null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`I am facing ${question.title}`}
          testID="quiz-direction-lock"
          onPress={() => setGuess(heading.value)}
          style={({ pressed }) => [
            styles.lock,
            { backgroundColor: theme.accentSoft },
            pressed && { opacity: 0.85 },
          ]}>
          <ThemedText type="smallBold" themeColor="accent">
            That’s it
          </ThemedText>
        </Pressable>
      ) : (
        <View style={styles.verdict} testID="quiz-direction-verdict">
          <ThemedText type="smallBold" themeColor={right ? 'accent' : 'textSecondary'}>
            {right ? 'Right.' : 'Not quite.'}
          </ThemedText>
          {/* The fact, either way: where it actually is. Built as ONE
              string rather than interpolated fragments — a sentence split
              across text nodes reads to VoiceOver as separate utterances,
              and cannot be matched as a sentence in a test either. */}
          <ThemedText type="small">
            {`${question.title} is ${compassWords(question.bearing)} of here` +
              (error !== null && error > DirectionToleranceDegrees
                ? `, and you were ${Math.round(error)}° out.`
                : `, and you were within ${Math.round(error ?? 0)}°.`)}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            testID="quiz-direction-source"
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
            testID="quiz-direction-next"
            onPress={() => onAnswered(right)}>
            <ThemedText type="linkPrimary">{last ? 'See the score' : 'Next question'}</ThemedText>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: Spacing.three,
    paddingTop: Spacing.three,
  },
  dialWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.three,
  },
  // The mark sits at the top of the dial and does not move: it is the
  // phone's own forward direction
  facing: {
    width: 4,
    height: Spacing.four,
    borderRadius: 2,
    marginBottom: -Spacing.two,
    zIndex: 1,
  },
  dial: {
    width: DialSize,
    height: DialSize,
    borderRadius: DialSize / 2,
    borderCurve: 'continuous',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Each cardinal is rotated into place around the rim
  cardinal: {
    position: 'absolute',
    width: DialSize,
    height: DialSize,
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  lock: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  verdict: {
    gap: Spacing.two,
  },
});
