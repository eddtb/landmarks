/**
 * The rows the row PLAN could only name.
 *
 * `gazetteer-rows-test.ts` asserts `buildGazetteerRows` returns
 * `['brief', 'timeline', 'part', …]` and stops there. Three of those
 * kinds — `brief`, `timeline`, `retelling-halted` — were rendered by no
 * test at all, so their renderers could return null and the plan would
 * still be perfect. And `partRowIndex` was checked in isolation while
 * its only consumer, tap a year and land on the part that tells it,
 * was not: point the jump at row 0 and the pure function stays right
 * while every year on the strip goes to the top of the story.
 *
 * So this file renders them and uses them.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList } from 'react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { Retold } from '@/types/retold';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const article = {
  minutes: 6,
  images: [],
  chapters: [{ title: '', paragraphs: ['The old palace stood here.'] }],
};

const retold: Retold = {
  minutes: 7,
  brief: ['The last tea clipper.', 'Dry-docked here since 1954.'],
  timeline: [
    { year: '1491', label: 'Henry VIII born here', part: 2 },
    { year: '1851', label: 'The Meridian established', part: 3 },
  ],
  parts: [
    { heading: 'Birthplace of Kings', body: 'Part one’s prose.' },
    { heading: 'Tudor Favourite', body: 'Part two’s prose.' },
    { heading: 'The Meridian', body: 'Part three’s prose.' },
  ],
};

/** The retelling leg, answering however this test needs it to. */
function serve(retoldAnswer: () => Promise<unknown>) {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes('/api/retold')) {
      return retoldAnswer();
    }
    if (path.includes('/api/article')) {
      return { ok: true, status: 200, json: async () => ({ article }) };
    }
    if (path.includes('/api/telling')) {
      return { ok: true, status: 200, json: async () => ({ telling: 'Venture’s telling.' }) };
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

const readyRetelling = async () => ({ ok: true, status: 200, json: async () => ({ retold }) });

/** An SSE body: one complete part, then the connection simply stops. */
function haltedAfterOnePart() {
  const encoder = new TextEncoder();
  const queue = [
    encoder.encode(
      `event: part\ndata: ${JSON.stringify({ index: 0, part: retold.parts[0] })}\n\n`
    ),
  ];
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'content-type' ? 'text/event-stream' : null) },
    body: {
      getReader: () => ({
        read: async () =>
          queue.length > 0
            ? { done: false, value: queue.shift() }
            : { done: true, value: undefined },
        cancel: async () => undefined,
      }),
    },
  };
}

async function paint(areaName: string) {
  await render(
    <AreaGazetteer
      areaName={areaName}
      relics={[]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
  await screen.findByTestId('gazetteer-hero');
}

beforeEach(() => {
  jest.clearAllMocks();
});

// The gazetteer is a VirtualizedList, which schedules its own cell work
// on a timer. Unmount first, then let that timer land, or it fires
// inside the NEXT test's render and collides with its act() scope.
afterEach(async () => {
  cleanup();
  await act(async () => {});
});

describe('the ten-second read', () => {
  test('the brief is a card a reader can actually read', async () => {
    serve(readyRetelling);
    await paint('Cutty Sark');

    expect(await screen.findByTestId('brief-card')).toBeOnTheScreen();
    expect(screen.getByText('In brief')).toBeOnTheScreen();
    for (const line of retold.brief) {
      expect(screen.getByText(line)).toBeOnTheScreen();
    }
  });
});

describe('the timeline, and the tap it exists for', () => {
  test('every stop is on the strip, as a year and what happened', async () => {
    serve(readyRetelling);
    await paint('Greenwich, timeline');

    const stops = await screen.findAllByTestId('timeline-stop');
    expect(stops).toHaveLength(2);
    expect(screen.getByText('1491')).toBeOnTheScreen();
    expect(screen.getByText('Henry VIII born here')).toBeOnTheScreen();
    // The label says where the tap goes — VoiceOver gets the whole job
    expect(stops[1]).toHaveProp(
      'accessibilityLabel',
      '1851: The Meridian established — read part 3'
    );
  });

  test('tapping a year scrolls to the PART that tells it, not to the top', async () => {
    const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex').mockImplementation(() => {});
    try {
      serve(readyRetelling);
      await paint('Greenwich, jump');
      const stops = await screen.findAllByTestId('timeline-stop');

      // 1491 belongs to part 2. This retelling has a brief, so the rows
      // are [brief, timeline, part, part, part, ai-label, source-link]
      // and part two is row 3 — which is also why the index must be
      // computed from the rows rather than from the part number: adding
      // the brief above moved every part down by one.
      await fireEvent.press(stops[0]);
      expect(scrollToIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ index: 3 })
      );

      // …and the second year goes somewhere ELSE, which is the whole
      // point of the strip
      await fireEvent.press(stops[1]);
      expect(scrollToIndex).toHaveBeenLastCalledWith(
        expect.objectContaining({ index: 4 })
      );
    } finally {
      scrollToIndex.mockRestore();
    }
  });
});

describe('a retelling that stopped mid-sentence', () => {
  test('what arrived stays, and the rest is offered in words', async () => {
    serve(async () => haltedAfterOnePart());
    await paint('Greenwich, halted');

    // The part that landed is still on the screen
    expect(await screen.findByText('Birthplace of Kings')).toBeOnTheScreen();
    expect(screen.getByText('Part one’s prose.')).toBeOnTheScreen();

    // …and the break is named, with where it happened and the verb that
    // fixes it — never a bare spinner or silence
    expect(screen.getByTestId('retelling-halted')).toBeOnTheScreen();
    expect(screen.getByText('Stopped after part 1')).toBeOnTheScreen();
    expect(
      screen.getByText('The connection dropped mid-sentence. What’s written above stays.')
    ).toBeOnTheScreen();
    expect(screen.getByText('Write the rest')).toBeOnTheScreen();
  });

  test('“Write the rest” re-asks, and the finished telling replaces the panel', async () => {
    serve(async () => haltedAfterOnePart());
    await paint('Greenwich, retried');
    await screen.findByTestId('retelling-halted');

    serve(readyRetelling);
    await fireEvent.press(screen.getByTestId('retell-retry'));

    expect(await screen.findByText('The Meridian')).toBeOnTheScreen();
    expect(screen.queryByTestId('retelling-halted')).toBeNull();
  });
});
