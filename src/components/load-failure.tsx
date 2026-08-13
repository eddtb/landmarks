import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { LoadVerdict } from '@/data/load-verdict';
import { useTheme } from '@/hooks/use-theme';
import { formatDaySince } from '@/utils/format';

/**
 * "Stated plainly" (approved direction, mocks ee987a5a): when Venture
 * fails it says what it asked, what came back, and offers the one
 * control that fixes it as a real 44pt button.
 *
 * The point of the direction is STRUCTURAL, not cosmetic. Three
 * situations, three grammars a reader can tell apart without reading
 * the words:
 *
 * - **Failure** — this panel. A surface, an eyebrow, a headline, a
 *   cause and a button.
 * - **Absence** — no panel and NO RETRY, ever. A retry against a 404
 *   teaches a reader that their tap does nothing. Absence gets the
 *   relics instead (`AbsentRecord` below).
 * - **Offline** — one grey line in the margin (`SavedCopyLine`). Being
 *   offline is not an error and must not wear an error's shape.
 *
 * Failure and absence were the same sentence until #291, which is the
 * bug: "No recorded story for this area yet" is a claim about the
 * historical record, and it printed because a worker was recycling.
 */

/**
 * Every surface that reports a load failure, as DATA rather than as a
 * type alone — `failure-and-absence-test` walks this list, so a fifth
 * surface joins the fence the moment it is added here, and the
 * exhaustive `Surfaces` record below will not compile without its copy.
 */
export const FailureSurfaces = ['area-article', 'feed', 'story', 'quiz'] as const;

export type FailureSurface = (typeof FailureSurfaces)[number];

/** The two ways an ask can fail. A 404 is not on this list on purpose:
 * absence never reaches this panel. */
export const FailureCauses = ['silent', 'errored'] as const;

export type FailureCause = Extract<LoadVerdict, (typeof FailureCauses)[number]>;

type Copy = {
  /** What broke, named. Never "this", never "stories" unqualified. */
  headline: string;
  /** What came back, and what is still intact. */
  body: Record<FailureCause, string>;
  /** The retry word is the verb of the thing — never "Try again",
   * which shipped to four screens as a placeholder. */
  action: string;
};

const Surfaces: Record<FailureSurface, Copy> = {
  'area-article': {
    headline: 'Wikipedia didn’t answer',
    body: {
      silent:
        'Venture asked twice and nothing came back. Nothing is missing from the record — only from this screen.',
      errored:
        'Venture asked twice and the answer was an error. Nothing is missing from the record — only from this screen.',
    },
    action: 'Ask again',
  },
  feed: {
    headline: 'Venture couldn’t reach the stories',
    body: {
      silent:
        'The request went out and nothing came back. Your saved stories are still on the phone.',
      errored:
        'The request went out and the answer was an error. Your saved stories are still on the phone.',
    },
    action: 'Look again',
  },
  story: {
    headline: 'This story didn’t come back',
    body: {
      silent: 'The link is good — the request wasn’t.',
      errored: 'The link is good — the answer came back an error.',
    },
    action: 'Ask again',
  },
  quiz: {
    headline: 'The quiz didn’t come back',
    body: {
      silent: 'The questions are written from the stories you just saw. Nothing was lost.',
      errored:
        'The answer came back an error. The questions are written from the stories you just saw. Nothing was lost.',
    },
    action: 'Set the quiz again',
  },
};

/** The eyebrow every failure wears, and only failure. */
export const FailureEyebrow = 'No answer';

/**
 * A verdict, narrowed to what a panel can say. Absence never reaches a
 * panel from the article path — it has its own grammar — but Venture's
 * OWN routes always have an answer to give, so a 404 from one of them
 * is a broken answer rather than a fact about history.
 */
export function failureCause(verdict: LoadVerdict): FailureCause {
  return verdict === 'errored' || verdict === 'absent' ? 'errored' : 'silent';
}

/** Pure, so the words can be read without a renderer. */
export function failureCopy(
  surface: FailureSurface,
  cause: FailureCause
): { eyebrow: string; headline: string; body: string; action: string } {
  const copy = Surfaces[surface];
  return {
    eyebrow: FailureEyebrow,
    headline: copy.headline,
    body: copy.body[cause],
    action: copy.action,
  };
}

/**
 * The panel every failure wears. A card, because failure is the one
 * state that has something to be done about it and the button needs a
 * surface to sit on; absence and offline deliberately get neither.
 *
 * Shared with the halted retelling, whose headline names the part it
 * stopped at and so cannot come from the static table above.
 */
export function FailurePanel({
  eyebrow,
  headline,
  body,
  action,
  onAction,
  testID,
  actionTestID,
}: {
  /** Omitted where the headline is already the whole news. */
  eyebrow?: string;
  headline: string;
  body: string;
  action: string;
  onAction: () => void;
  testID: string;
  actionTestID: string;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.panel, { backgroundColor: theme.backgroundElement }]} testID={testID}>
      {eyebrow !== undefined && (
        <ThemedText type="eyebrow" themeColor="textSecondary">
          {eyebrow}
        </ThemedText>
      )}
      <ThemedText type="headline">{headline}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {body}
      </ThemedText>
      {/* A word, not a glyph, and 44pt of it. Text on the accent takes
          theme.background: #FFFFFF on the dark accent is 2.79:1. */}
      <Pressable
        accessibilityRole="button"
        testID={actionTestID}
        onPress={onAction}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: theme.accent },
          pressed && styles.pressed,
        ]}>
        <ThemedText type="smallBold" themeColor="background">
          {action}
        </ThemedText>
      </Pressable>
    </View>
  );
}

/** The panel with this surface's words in it. */
export function LoadFailure({
  surface,
  cause,
  onRetry,
}: {
  surface: FailureSurface;
  cause: FailureCause;
  onRetry: () => void;
}) {
  const copy = failureCopy(surface, cause);
  return (
    <FailurePanel
      eyebrow={copy.eyebrow}
      headline={copy.headline}
      body={copy.body}
      action={copy.action}
      onAction={onRetry}
      testID={`load-failed-${surface}`}
      actionTestID={`retry-${surface}`}
    />
  );
}

/**
 * Absence, in the grammar failure does not get: an eyebrow, a
 * statement, and the relics. No panel and no retry — the ask worked,
 * and a second tap would ask the same question and get the same answer.
 */
export function absentRecordCopy(name: string, relics: number): { title: string; line: string } {
  return {
    title: `Wikipedia has no article for ${name}`,
    line:
      relics === 1
        ? 'One relic stands on this ground anyway. It’s below.'
        : `${spelledOut(relics)} relics stand on this ground anyway. They’re below.`,
  };
}

/** Counts a reader would say aloud. Past twelve, the numeral is how
 * anyone would say it. */
const Numbers = [
  'No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six',
  'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
];
function spelledOut(count: number): string {
  return Numbers[count] ?? String(count);
}

/**
 * Offline, borrowing "In the margin"'s restraint: one grey line where
 * the admission belongs, no surface and no control. The phone being
 * offline is a fact about the phone, not a failure of the app, and it
 * outranks every other verdict — with no request on the wire we know
 * nothing about the record and must not describe it.
 */
export function savedCopyLine(name: string | null | undefined, savedAt?: number): string {
  const place = name ?? 'this ground';
  if (savedAt === undefined) {
    return `Offline — showing ${place} as it is saved on this phone.`;
  }
  const day = formatDaySince(savedAt);
  // formatDaySince answers "today" / "yesterday" / "Tuesday" / "8 August"
  const when = day === 'today' || day === 'yesterday' ? day : `on ${day}`;
  return `Offline — ${place} as it was saved ${when}.`;
}

export function SavedCopyLine({
  name,
  savedAt,
  style,
}: {
  name: string | null | undefined;
  savedAt?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.margin, style]} testID="offline-saved-copy">
      <ThemedText type="small" themeColor="textSecondary">
        {savedCopyLine(name, savedAt)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: Spacing.four,
    marginTop: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
    gap: Spacing.one,
  },
  action: {
    marginTop: Spacing.two,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Spacing.three - 2,
    borderCurve: 'continuous',
  },
  pressed: {
    opacity: 0.85,
  },
  margin: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.three,
  },
});
