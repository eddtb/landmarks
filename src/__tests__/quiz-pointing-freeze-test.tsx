/**
 * The pointing finale is FROZEN at the moment the run begins (#293).
 *
 * `pointing` is re-derived from the live GPS centre on every tick. Fed
 * to the run raw, the target changed under an already-locked guess —
 * the verdict was judged against a bearing nobody was asked about, and
 * the sentence named a place from a different question. Worse: walk
 * inside 100m of the last eligible story and `pointing` went null
 * mid-answer, the finale vanished, and the run fell into the score
 * screen with `total` silently one smaller.
 *
 * These tests drive the run through its own prop seam: the parent
 * hands down a LIVE `pointing` exactly as QuizBody does, the harness
 * swaps it mid-run, and the reader must see the question they were
 * asked — every time.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import { QuizRun } from '@/components/quiz-run';
import { Quiz } from '@/types/quiz';
import { DirectionQuestion } from '@/utils/quiz-direction';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

// The magnetometer, which no simulator has: the reader faces north-east
const mockHeading = { value: 45 };
jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: mockHeading, available: true }),
}));

jest.mock('@/data/quiz-client', () => ({
  orderedByYear: (items: { year: number }[]) => [...items].sort((a, b) => a.year - b.year),
}));

jest.mock('@/data/quiz-progress', () => ({
  Ranks: ['Stranger', 'Visitor', 'Local'],
  rankFor: () => 'Stranger',
  recordRun: jest.fn(),
  useAreaProgress: () => undefined,
}));

/** A quiz of written questions only — the finale arrives as a prop. */
const quiz: Quiz = { areaName: 'Greenwich', questions: [] };

const trinity: DirectionQuestion = {
  pageId: 71,
  title: 'Trinity Hospital',
  bearing: 40,
  distanceMeters: 140,
};

const queensHouse: DirectionQuestion = {
  pageId: 72,
  title: "Queen's House",
  bearing: 220,
  distanceMeters: 300,
};

/**
 * QuizBody's seam, reproduced exactly: `begun` lives in the parent and
 * `pointing` arrives live — the harness's rerender IS the GPS tick.
 */
function Harness({ pointing }: { pointing: DirectionQuestion | null }) {
  const [begun, setBegun] = useState(false);
  return (
    <QuizRun
      quiz={quiz}
      pointing={pointing}
      areaLabel="Greenwich"
      begun={begun}
      onBegin={() => setBegun(true)}
    />
  );
}

// State commits a tick after each press in this harness (the
// quiz-screen suite's own note), so every press is settled by finding
// what it produced before asserting on it.
test('the target cannot change under a locked guess', async () => {
  const { rerender } = await render(<Harness pointing={trinity} />);
  fireEvent.press(await screen.findByTestId('quiz-begin'));
  expect(await screen.findByText('Which way is Trinity Hospital?')).toBeOnTheScreen();

  // The reader drifts 20m; the live derivation now picks another place
  await rerender(<Harness pointing={queensHouse} />);

  // The question they were asked is the question on the screen
  expect(screen.getByText('Which way is Trinity Hospital?')).toBeOnTheScreen();
  expect(screen.queryByText("Which way is Queen's House?")).not.toBeOnTheScreen();

  // …and the verdict is judged against ITS bearing: heading 45 vs
  // Trinity's 40 is within tolerance — against Queen's House's 220 it
  // would read "Not quite"
  fireEvent.press(screen.getByTestId('quiz-direction-lock'));
  expect(await screen.findByText('Right.')).toBeOnTheScreen();
  expect(screen.getByText(/Trinity Hospital is/)).toBeOnTheScreen();
});

test('the finale cannot vanish mid-answer, and the total holds', async () => {
  const { rerender } = await render(<Harness pointing={trinity} />);
  fireEvent.press(await screen.findByTestId('quiz-begin'));
  expect(await screen.findByText('1 of 1')).toBeOnTheScreen();

  // The reader walks inside 100m of the last eligible story: the live
  // derivation goes null. The question they are mid-way through
  // answering must not fall into the score screen unanswered.
  await rerender(<Harness pointing={null} />);

  expect(screen.getByTestId('quiz-direction')).toBeOnTheScreen();
  expect(screen.getByText('1 of 1')).toBeOnTheScreen();
  expect(screen.queryByTestId('quiz-done')).not.toBeOnTheScreen();

  // Answered, the run ends with the finale COUNTED
  fireEvent.press(screen.getByTestId('quiz-direction-lock'));
  fireEvent.press(await screen.findByTestId('quiz-direction-next'));
  expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();
  expect(screen.getByText('1 of 1')).toBeOnTheScreen();
});

test('a fresh round asks from where the reader now stands', async () => {
  const { rerender } = await render(<Harness pointing={trinity} />);
  fireEvent.press(await screen.findByTestId('quiz-begin'));
  fireEvent.press(await screen.findByTestId('quiz-direction-lock'));
  fireEvent.press(await screen.findByTestId('quiz-direction-next'));
  expect(await screen.findByTestId('quiz-done')).toBeOnTheScreen();

  // The reader moved between rounds — the freeze is per-run, not
  // per-mount, so Another round re-captures the LIVE question
  await rerender(<Harness pointing={queensHouse} />);
  fireEvent.press(screen.getByTestId('quiz-again'));

  expect(await screen.findByText("Which way is Queen's House?")).toBeOnTheScreen();
  expect(screen.queryByText('Which way is Trinity Hospital?')).not.toBeOnTheScreen();
});
