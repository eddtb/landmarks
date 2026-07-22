import { diskBackedMap } from '@/server/ai-cache';

// Same guarded require the module itself uses — the app tsconfig has
// no node types, and this test only runs under node
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { existsSync, rmSync } = require('fs') as {
  existsSync: (path: string) => boolean;
  rmSync: (path: string) => void;
};

/**
 * The cache's whole job is surviving the process: entries written
 * before a dev-server restart must hydrate after it. Simulated here
 * by dropping the in-memory instance and re-creating from disk.
 */
describe('diskBackedMap', () => {
  const name = 'test-suite-cache';
  const path = `${process.env.AI_CACHE_DIR}/${name}.json`;

  afterAll(() => {
    if (existsSync(path)) {
      rmSync(path);
    }
  });

  test('entries survive a simulated process restart', async () => {
    const map = diskBackedMap<{ events: string[] }>(name);
    map.set('venue-1', { events: ['Quiz night'] });

    // The write is debounced 2s — wait it out
    await new Promise((resolve) => setTimeout(resolve, 2600));
    expect(existsSync(path)).toBe(true);

    // "Restart": drop the in-memory instance, hydrate fresh from disk
    (globalThis as { aiDiskMaps?: Map<string, unknown> }).aiDiskMaps?.delete(name);
    const rehydrated = diskBackedMap<{ events: string[] }>(name);
    expect(rehydrated.get('venue-1')).toEqual({ events: ['Quiz night'] });
  });

  test('same name returns the same live instance', () => {
    const a = diskBackedMap<number>(name);
    const b = diskBackedMap<number>(name);
    a.set('k', 7);
    expect(b.get('k')).toBe(7);
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { extractAnswerText } = require('@/server/gemini') as {
  extractAnswerText: (parts: { text?: string; thought?: boolean }[]) => string;
};

describe('extractAnswerText (Gemini part handling)', () => {
  test('drops thought parts and takes the fenced block when present', () => {
    const text = extractAnswerText([
      { text: 'Let me research this venue…', thought: true },
      { text: 'Here is the answer:\n```json\n[{"title": "Quiz Night"}]\n```' },
      { text: '```json\n[{"title": "Quiz Night"}]\n```' },
    ]);
    // The duplicate-block trap: first fenced block wins, cleanly
    expect(JSON.parse(text)).toEqual([{ title: 'Quiz Night' }]);
  });

  test('plain unfenced answers pass through untouched', () => {
    expect(extractAnswerText([{ text: '[{"a": 1}]' }])).toBe('[{"a": 1}]');
  });
});

describe('extractAnswerText truncation handling', () => {
  test('skips a truncated first block for the complete repeat', () => {
    const text = extractAnswerText([
      { text: '```json\n[{"title": "Quiz", "sourceUrl": "https://truncat' },
      { text: '```\n```json\n[{"title": "Quiz", "sourceUrl": "https://full.example"}]\n```' },
    ]);
    expect(JSON.parse(text)).toEqual([{ title: 'Quiz', sourceUrl: 'https://full.example' }]);
  });
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { makeGeminiSseDecoder } = require('@/server/gemini') as {
  makeGeminiSseDecoder: () => {
    feed: (chunk: string) => string[];
    usage: () => { candidatesTokenCount?: number } | undefined;
  };
};

describe('makeGeminiSseDecoder (streamGenerateContent alt=sse framing)', () => {
  const dataLine = (text: string, extra = '') =>
    `data: {"candidates": [{"content": {"parts": [{"text": ${JSON.stringify(text)}}]}}]${extra}}\n\n`;

  test('deltas surface per complete data line, across any network chunking', () => {
    const wire = dataLine('The palace ') + dataLine('stood here.');
    const decoder = makeGeminiSseDecoder();
    const deltas = [...wire].flatMap((char) => decoder.feed(char));
    expect(deltas).toEqual(['The palace ', 'stood here.']);
  });

  test('thought parts are dropped, exactly as in the one-shot path', () => {
    const decoder = makeGeminiSseDecoder();
    const deltas = decoder.feed(
      'data: {"candidates": [{"content": {"parts": [{"text": "hmm", "thought": true}, {"text": "answer"}]}}]}\n\n'
    );
    expect(deltas).toEqual(['answer']);
  });

  test('usage metadata is kept from the last chunk that carried it', () => {
    const decoder = makeGeminiSseDecoder();
    decoder.feed(dataLine('a', ', "usageMetadata": {"candidatesTokenCount": 42}'));
    expect(decoder.usage()?.candidatesTokenCount).toBe(42);
  });

  test('an error chunk throws instead of vanishing into the buffer', () => {
    const decoder = makeGeminiSseDecoder();
    expect(() => decoder.feed('data: {"error": {"message": "quota exceeded"}}\n\n')).toThrow(
      'quota exceeded'
    );
  });
});

/**
 * The clobber regression: two processes sharing .ai-cache must never
 * erase each other's entries. Simulated by writing a "foreign" entry
 * straight to disk after hydration — the next flush must keep it.
 */
describe('diskBackedMap merge-on-write', () => {
  const name = 'test-merge-cache';
  const path = `${process.env.AI_CACHE_DIR}/${name}.json`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { writeFileSync, readFileSync } = require('fs') as {
    writeFileSync: (path: string, data: string) => void;
    readFileSync: (path: string, encoding: 'utf8') => string;
  };

  afterAll(() => {
    if (existsSync(path)) {
      rmSync(path);
    }
  });

  test("another process's entries survive this process's flush", async () => {
    const map = diskBackedMap<string>(name);
    map.set('ours', 'from this process');

    // Another process writes its own entry (plus a stale copy of ours)
    // AFTER we hydrated — the old code would erase it on flush
    writeFileSync(
      path,
      JSON.stringify([
        ['theirs', 'from the other process'],
        ['ours', 'their stale copy'],
      ])
    );

    map.set('ours-2', 'trigger a flush');
    await new Promise((resolve) => setTimeout(resolve, 2600));

    const onDisk = new Map(JSON.parse(readFileSync(path, 'utf8')) as [string, string][]);
    expect(onDisk.get('theirs')).toBe('from the other process'); // preserved, not clobbered
    expect(onDisk.get('ours')).toBe('from this process'); // in-memory wins for our keys
    expect(onDisk.get('ours-2')).toBe('trigger a flush');
  });
});
