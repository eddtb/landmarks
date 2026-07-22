/**
 * The streaming transport for the retold call (still ONE call site):
 * complete parts surface as they are written, the 30-day cache is
 * written only when the finished telling parses valid, and the budget
 * breaker refuses BEFORE any stream opens — a truncated stream caches
 * nothing, because couldn't-finish is not a verdict.
 */

import { makePartScanner } from '@/server/retold';
import { RetoldPart } from '@/types/retold';

type Chapter = { title: string; paragraphs: string[] };

const validRetold = {
  parts: [
    { heading: 'One', body: 'First part body here.' },
    { heading: 'Two', body: 'Second part body here.' },
    { heading: 'Three', body: 'Third part body here.' },
  ],
  timeline: [{ year: '1491', label: 'A dated moment', part: 1 }],
};
const validRetoldText = JSON.stringify(validRetold);

const richChapters: Chapter[] = [
  { title: '', paragraphs: ['x'.repeat(2000)] },
  { title: 'History', paragraphs: ['y'.repeat(2000)] },
];

function loadRetold(options: { streamImpl?: () => AsyncGenerator<string, void, void> }) {
  jest.resetModules();
  const researchStream = jest.fn(
    options.streamImpl ??
      async function* () {
        yield validRetoldText;
      }
  );
  const getArticle = jest.fn(async () => ({ minutes: 3, images: [], chapters: richChapters }));
  const backing = new Map<string, unknown>();
  jest.doMock('@/server/anthropic', () => ({ researchStream }));
  jest.doMock('@/server/article', () => ({ getArticle }));
  jest.doMock('@/server/ai-cache', () => ({ diskBackedMap: () => backing }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const retold = require('@/server/retold') as typeof import('@/server/retold');
  return { retold, researchStream, backing };
}

async function collect(events: AsyncGenerator<unknown, void, void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  for await (const event of events) {
    seen.push(event);
  }
  return seen;
}

/** Feed text to a scanner in fixed-size chunks, collecting parts. */
function feedChunked(text: string, size: number): RetoldPart[] {
  const scanner = makePartScanner();
  const parts: RetoldPart[] = [];
  for (let at = 0; at < text.length; at += size) {
    parts.push(...scanner.feed(text.slice(at, at + size)));
  }
  return parts;
}

describe('makePartScanner (complete parts only, across any chunking)', () => {
  const fenced =
    '```json\n' +
    JSON.stringify({
      parts: [
        {
          heading: 'The Palace',
          body: 'The palace stood here. It was grand.',
          pullQuote: 'The palace stood here.',
        },
        { heading: 'Braces', body: 'Braces { } and "quotes" and ]} inside a string.' },
        { heading: 'The End', body: 'A closing part.', pullQuote: 'Nowhere in the body.' },
      ],
      timeline: [{ year: '1491', label: 'Not a part', part: 1 }],
    }) +
    '\n```';

  test.each([1, 3, 7, 1000])('chunk size %d: same three parts, cleaned', (size) => {
    const parts = feedChunked(fenced, size);
    expect(parts.map((part) => part.heading)).toEqual(['The Palace', 'Braces', 'The End']);
    // Cleaned by parseRetold's rules: verbatim pull-quotes survive,
    // invented ones die — the live render matches the final telling
    expect(parts[0].pullQuote).toBe('The palace stood here.');
    expect(parts[2].pullQuote).toBeUndefined();
  });

  test('a part surfaces the moment it completes — not before, not after', () => {
    const scanner = makePartScanner();
    const [head, tail] = ['{"parts": [{"heading": "A", "body": "Done."}, {"heading": "B", "bo', 'dy": "Later."}]}'];
    expect(scanner.feed(head).map((part) => part.heading)).toEqual(['A']);
    expect(scanner.feed(tail).map((part) => part.heading)).toEqual(['B']);
  });

  test('a trailing half-written part is never yielded', () => {
    const scanner = makePartScanner();
    const parts = scanner.feed('{"parts": [{"heading": "A", "body": "Done."}, {"heading": "B", "body": "A half-written paragra');
    expect(parts).toHaveLength(1);
    expect(scanner.feed('')).toHaveLength(0); // still unfinished
  });

  test('timeline objects after the parts array are not parts', () => {
    const parts = feedChunked(fenced, 5);
    expect(parts).toHaveLength(3);
    expect(parts.some((part) => part.heading === 'Not a part')).toBe(false);
  });

  test('an escaped quote inside a body does not derail the scan', () => {
    const text = '{"parts": [{"heading": "A", "body": "She said \\"stay\\" { firmly }."}, {"heading": "B", "body": "Second."}]}';
    expect(feedChunked(text, 2).map((part) => part.heading)).toEqual(['A', 'B']);
  });
});

describe('startRetoldStream (the cold path, streamed)', () => {
  test('parts stream as they complete; done carries the telling; the cache is written on completion', async () => {
    const { retold, backing } = loadRetold({
      streamImpl: async function* () {
        // Realistic chunking: the wire splits mid-part, mid-string
        for (let at = 0; at < validRetoldText.length; at += 40) {
          yield validRetoldText.slice(at, at + 40);
        }
      },
    });
    const started = await retold.startRetoldStream('Greenwich');
    expect(started.kind).toBe('stream');
    expect(backing.size).toBe(0); // nothing cached while writing
    if (started.kind !== 'stream') {
      return;
    }
    const events = (await collect(started.events)) as {
      kind: string;
      index?: number;
      retold?: { parts: unknown[]; timeline: unknown[] };
    }[];
    expect(events.map((event) => event.kind)).toEqual(['part', 'part', 'part', 'done']);
    expect(events.map((event) => event.index).slice(0, 3)).toEqual([0, 1, 2]);
    const done = events[3];
    expect(done.retold?.parts).toHaveLength(3);
    expect(done.retold?.timeline).toHaveLength(1);
    // Cache-on-complete: written once, as the 30-day verdict
    expect(backing.get('greenwich')).toMatchObject({ retold: { minutes: 1 } });
    // …and the next open is a cache hit, no second call
    expect(retold.peekRetold('Greenwich')?.retold).toEqual(done.retold);
  });

  test('a truncated stream caches NOTHING — couldn\'t-finish is not a verdict', async () => {
    const { retold, backing } = loadRetold({
      streamImpl: async function* () {
        yield validRetoldText.slice(0, 80); // one complete part, then the wire dies
        throw new Error('socket reset');
      },
    });
    const started = await retold.startRetoldStream('Greenwich');
    if (started.kind !== 'stream') {
      throw new Error(`expected stream, got ${started.kind}`);
    }
    const events = (await collect(started.events)) as { kind: string; reason?: string }[];
    expect(events.at(-1)).toEqual({ kind: 'failed', reason: 'interrupted' });
    expect(events.filter((event) => event.kind === 'part')).toHaveLength(1);
    expect(backing.size).toBe(0);
    // The next ask may try again — the slot is free
    expect(retold.retellingInFlight('Greenwich')).toBe(false);
  });

  test('the breaker gates the STREAM: a refused call throws before any event, caches nothing', async () => {
    const { retold, researchStream, backing } = loadRetold({
      streamImpl: async function* (): AsyncGenerator<string, void, void> {
        throw new Error('REPLAY_ONLY refuses');
      },
    });
    await expect(retold.startRetoldStream('Greenwich')).rejects.toThrow('REPLAY_ONLY refuses');
    expect(backing.size).toBe(0);
    expect(retold.retellingInFlight('Greenwich')).toBe(false);
    // We couldn't try, so we may try again
    await expect(retold.startRetoldStream('Greenwich')).rejects.toThrow();
    expect(researchStream).toHaveBeenCalledTimes(2);
  });

  test('a COMPLETED stream that parses invalid keeps today\'s verdict: cached null, one call', async () => {
    const { retold, backing } = loadRetold({
      streamImpl: async function* () {
        yield JSON.stringify({ parts: validRetold.parts.slice(0, 2) }); // finished, but < 3 parts
      },
    });
    const started = await retold.startRetoldStream('Greenwich');
    if (started.kind !== 'stream') {
      throw new Error(`expected stream, got ${started.kind}`);
    }
    const events = (await collect(started.events)) as { kind: string; reason?: string }[];
    expect(events.at(-1)).toEqual({ kind: 'failed', reason: 'invalid' });
    expect(backing.get('greenwich')).toMatchObject({ retold: null });
  });

  test('while one stream writes, a second ask JOINS it — never a second call', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { retold, researchStream } = loadRetold({
      streamImpl: async function* () {
        // The first delta opens the stream; the rest waits on the gate
        yield validRetoldText.slice(0, 40);
        await gate;
        yield validRetoldText.slice(40);
      },
    });
    const first = await retold.startRetoldStream('Greenwich');
    expect(first.kind).toBe('stream');
    expect(await retold.startRetoldStream('Greenwich')).toEqual({ kind: 'join' });
    expect(retold.retellingInFlight('Greenwich')).toBe(true);
    // …and a concurrent JSON ask shares the same one call
    const shared = retold.getRetold('Greenwich');
    release();
    if (first.kind === 'stream') {
      await collect(first.events);
    }
    expect((await shared)?.parts).toHaveLength(3);
    expect(researchStream).toHaveBeenCalledTimes(1);
  });

  test('an ABANDONED stream (client disconnect) frees the slot and caches nothing', async () => {
    const { retold, backing } = loadRetold({
      streamImpl: async function* () {
        yield validRetoldText.slice(0, 80);
        yield validRetoldText.slice(80);
      },
    });
    const started = await retold.startRetoldStream('Greenwich');
    if (started.kind !== 'stream') {
      throw new Error(`expected stream, got ${started.kind}`);
    }
    const firstEvent = await started.events.next();
    expect((firstEvent.value as { kind: string }).kind).toBe('part');
    await started.events.return(undefined); // the route's cancel()
    expect(retold.retellingInFlight('Greenwich')).toBe(false);
    expect(backing.size).toBe(0);
  });
});
