/**
 * The 4.2.2 rule, fenced where it can actually fail.
 *
 * `gazetteer-rows-test.ts` used to hold this fence as
 * `expect(kinds).not.toContain('fallback-article')`, walked over all
 * five retelling states. `'fallback-article'` was deleted from the
 * union by the very commit that fixed the bug (daca00f, "The app stops
 * republishing Wikipedia"), so from the day it was written the
 * assertion could not fire: no code path anywhere could produce that
 * string. The rule most directly tied to an App Store rejection was
 * guarded by a tautology.
 *
 * The rule is not about a row KIND. It is about what a reader — or a
 * reviewer — sees: whatever state the screen is in, the prose on it is
 * Venture's own, and the source gets ONE citation rather than a copy of
 * itself. So this file renders the real screen against a real wire and
 * asks the screen. App Review's sentence was "only includes links,
 * images, or content aggregated from the Internet", cited three times;
 * the only honest answer to it is the rendered page.
 */
import { cleanup, render, screen } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { HistoryItem } from '@/types/history';
import { Retold } from '@/types/retold';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

/**
 * The source article, in sentences no other string in this file shares.
 * Prince Frederick's Barge is the case daca00f measured: 504 characters
 * of Wikipedia, once shown entire under a "From Wikipedia" eyebrow.
 */
const SourceSentences = [
  'Prince Frederick’s Barge was built in 1731 to a design by William Kent.',
  'It was rowed by twenty-one oarsmen and last carried a monarch in 1849.',
];

const article = {
  minutes: 3,
  images: [],
  chapters: [{ title: '', paragraphs: SourceSentences }],
};

/** Venture's own writing, in both of the shapes that can carry a story. */
const TellingSentence = 'A royal rowing boat sat in a museum for a century.';
const RetoldSentence = 'The barge outlived every river it was built for.';

const retold: Retold = {
  minutes: 4,
  brief: [],
  timeline: [],
  parts: [{ heading: 'Built for a prince', body: RetoldSentence }],
};

const barge: HistoryItem = {
  pageId: 77,
  title: 'Prince Frederick’s Barge',
  coordinates: { latitude: 51.4826, longitude: -0.0077 },
  distanceMeters: 120,
  extract: SourceSentences[0],
  url: 'https://en.wikipedia.org/wiki/Prince_Frederick%27s_Barge',
  source: 'Wikipedia',
};

/** An SSE body, chunked the way expo/fetch delivers one. */
function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const queue = chunks.map((chunk) => encoder.encode(chunk));
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

const frame = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** Every shape the retelling leg can take, and the row plan each drives. */
type RetoldWire = 'ready' | 'absent' | 'pending' | 'halted';

const RetoldAnswer: Record<RetoldWire, () => Promise<unknown>> = {
  // A server cache hit: the whole retelling as JSON
  ready: async () => ({ ok: true, status: 200, json: async () => ({ retold }) }),
  // No retelling earned this place — the branch that used to republish
  absent: async () => ({ ok: false, status: 404 }),
  // Still writing: the ask never settles
  pending: () => new Promise(() => {}),
  // A stream that dropped mid-sentence, one part in
  halted: async () =>
    sseResponse([frame('part', { index: 0, part: retold.parts[0] })]),
};

function serve(wire: RetoldWire) {
  mockFetch.mockImplementation(async (url: string, init?: { method?: string }) => {
    const path = String(url);
    if (path.includes('/api/retold')) {
      return RetoldAnswer[wire]();
    }
    if (path.includes('/api/article')) {
      return { ok: true, status: 200, json: async () => ({ article }) };
    }
    if (path.includes('/api/telling') && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ telling: TellingSentence }) };
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

/**
 * Every string the rendered page displays, joined. Deliberately the
 * whole tree rather than a scoped text query: republication is prose
 * appearing ANYWHERE on the screen, and a query scoped to a row could
 * not see it appear beside one.
 */
type RenderedNode = { children?: unknown } | string | null;

function displayedText(node: unknown): string[] {
  if (typeof node === 'string') {
    return [node];
  }
  if (Array.isArray(node)) {
    return node.flatMap(displayedText);
  }
  if (node && typeof node === 'object') {
    return displayedText((node as RenderedNode as { children?: unknown }).children);
  }
  return [];
}

const pageText = () => displayedText(screen.toJSON()).join(' ');

/** A fresh area name per case: the article and retold clients both hold
 *  module-level caches keyed by it. */
async function paint(wire: RetoldWire, areaName: string) {
  serve(wire);
  await render(
    <AreaGazetteer
      areaName={areaName}
      areaLabel="Prince Frederick’s Barge"
      relics={[]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
      sourceUrl={barge.url}
      tellingItem={barge}
    />
  );
  // The hero paints when the article lands — the point past which the
  // screen has decided what to show
  await screen.findByTestId('gazetteer-hero');
}

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('no state of a story screen republishes its source', () => {
  const cases: { wire: RetoldWire; what: string; area: string }[] = [
    { wire: 'absent', what: 'no retelling earned this place', area: 'Barge, unretold' },
    { wire: 'ready', what: 'a finished retelling', area: 'Barge, retold' },
    { wire: 'pending', what: 'a retelling still being written', area: 'Barge, writing' },
    { wire: 'halted', what: 'a retelling that stopped mid-stream', area: 'Barge, halted' },
  ];

  test.each(cases)('$what: the source article body is nowhere on the screen', async ({ wire, area }) => {
    await paint(wire, area);

    for (const sentence of SourceSentences) {
      expect(pageText()).not.toContain(sentence);
    }
  });

  test.each(cases.filter((one) => one.wire === 'absent' || one.wire === 'ready'))(
    '$what: and the source is cited exactly once',
    async ({ wire, area }) => {
      await paint(wire, `${area}, cited`);

      // One citation, reading as attribution. There were three mentions
      // of Wikipedia on this screen when App Review last saw it.
      const citations = await screen.findAllByTestId('wikipedia-link');
      expect(citations).toHaveLength(1);
      expect(screen.getByText('Source: Wikipedia ›')).toBeOnTheScreen();
      // "Read more" framed the source as the fuller product — the
      // opposite of what is true now our own writing is the story
      expect(screen.queryByText(/Read more on Wikipedia/)).toBeNull();
      expect(wire).toBeDefined();
    }
  );

  test('mid-write, the door out is a LINK to the source, never a copy of it', async () => {
    // The longest wait in the app, and the one place the source is
    // offered ahead of Venture's own writing — as a door, in a word
    await paint('pending', 'Barge, door');

    expect(await screen.findByTestId('retelling-read-source')).toBeOnTheScreen();
    expect(screen.getByText('Read the Wikipedia article instead')).toBeOnTheScreen();
    for (const sentence of SourceSentences) {
      expect(pageText()).not.toContain(sentence);
    }
  });
});

describe('what stands in the article body’s place is Venture’s own writing', () => {
  test('unretold: the telling leads, and it is prose the reader can read', async () => {
    await paint('absent', 'Barge, told');

    expect(await screen.findByText(TellingSentence)).toBeOnTheScreen();
    // …and it says whose writing it is, under the piece
    expect(screen.getByText('Told by AI from Wikipedia — source below')).toBeOnTheScreen();
    expect(pageText()).not.toContain(SourceSentences[1]);
  });

  test('retold: the retelling’s own parts carry the screen', async () => {
    await paint('ready', 'Barge, parts');

    expect(await screen.findByText(RetoldSentence)).toBeOnTheScreen();
    expect(screen.getByText('Built for a prince')).toBeOnTheScreen();
    expect(pageText()).not.toContain(SourceSentences[1]);
  });

  test('a failed telling says so rather than leaving the source standing alone', async () => {
    // The regression this pairs with: TellingLead used to render null on
    // failure, which left the extract as the whole story — the app
    // looking exactly like the aggregator it is not.
    mockFetch.mockImplementation(async (url: string) => {
      const path = String(url);
      if (path.includes('/api/retold')) {
        return { ok: false, status: 404 };
      }
      if (path.includes('/api/article')) {
        return { ok: true, status: 200, json: async () => ({ article }) };
      }
      return { ok: false, status: 502 };
    });
    await render(
      <AreaGazetteer
        areaName="Barge, telling failed"
        relics={[]}
        allStories={[]}
        refreshing={false}
        onRefresh={() => {}}
        sourceUrl={barge.url}
        // A pageId of its own: the telling client session-caches by it,
        // and the cases above have already written slot 77
        tellingItem={{ ...barge, pageId: 78 }}
      />
    );

    expect(await screen.findByTestId('telling-failed')).toBeOnTheScreen();
    expect(screen.getByText('Write it again')).toBeOnTheScreen();
    for (const sentence of SourceSentences) {
      expect(pageText()).not.toContain(sentence);
    }
  });
});
