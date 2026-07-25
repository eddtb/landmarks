/**
 * The call economy: every getRetold guard exists to keep the free-tier
 * quota from leaking (Edd: "concerned about the amount of gemini calls
 * we will now be making"). One story = at most one call per TTL window,
 * whatever the UI does.
 */

type Chapter = { title: string; paragraphs: string[] };

const validRetoldText = JSON.stringify({
  parts: [
    { heading: 'One', body: 'First part body here.' },
    { heading: 'Two', body: 'Second part body here.' },
    { heading: 'Three', body: 'Third part body here.' },
  ],
  timeline: [],
});

function loadRetold(options: {
  chapters: Chapter[] | null;
  researchImpl?: jest.Mock;
  /** What the durable store answers; default is a miss (store off). */
  storedGet?: jest.Mock;
}) {
  jest.resetModules();
  // The call now travels the streaming transport — one researchStream
  // generator per spend, whole answer as a single delta by default
  const researchStream =
    options.researchImpl ??
    jest.fn(async function* () {
      yield validRetoldText;
    });
  const getArticle = jest.fn(async () =>
    options.chapters ? { minutes: 3, images: [], chapters: options.chapters } : null
  );
  const storeGet = options.storedGet ?? jest.fn(async () => undefined);
  const storePut = jest.fn();
  jest.doMock('@/server/anthropic', () => ({ researchStream }));
  jest.doMock('@/server/article', () => ({ getArticle }));
  jest.doMock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
  jest.doMock('@/server/telling-store', () => ({ storeGet, storePut }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const retold = require('@/server/retold') as typeof import('@/server/retold');
  return { retold, research: researchStream, getArticle, storeGet, storePut };
}

const richChapters: Chapter[] = [
  { title: '', paragraphs: ['x'.repeat(2000)] },
  { title: 'History', paragraphs: ['y'.repeat(2000)] },
];
const stubChapters: Chapter[] = [{ title: '', paragraphs: ['A short stub.'] }];

describe('getRetold call economy', () => {
  test('a stub article never spends a call — now or on the next open', async () => {
    const { retold, research, getArticle } = loadRetold({ chapters: stubChapters });
    expect(await retold.getRetold('Small Plaque')).toBeNull();
    expect(await retold.getRetold('Small Plaque')).toBeNull();
    expect(research).not.toHaveBeenCalled();
    expect(getArticle).toHaveBeenCalledTimes(1); // second open served from the negative cache
  });

  test('a failed parse is remembered: one call, not one per open', async () => {
    const research = jest.fn(async function* () {
      yield 'not json at all';
    });
    const { retold } = loadRetold({ chapters: richChapters, researchImpl: research });
    expect(await retold.getRetold('Greenwich')).toBeNull();
    expect(await retold.getRetold('Greenwich')).toBeNull();
    expect(research).toHaveBeenCalledTimes(1);
  });

  test('a THROWN call (breaker, replay-only) is not cached — we may try again', async () => {
    const research = jest.fn(async function* (): AsyncGenerator<string> {
      throw new Error('REPLAY_ONLY refuses');
    });
    const { retold } = loadRetold({ chapters: richChapters, researchImpl: research });
    await expect(retold.getRetold('Greenwich')).rejects.toThrow();
    await expect(retold.getRetold('Greenwich')).rejects.toThrow();
    expect(research).toHaveBeenCalledTimes(2);
  });

  test('concurrent opens of one story share a single call', async () => {
    const { retold, research } = loadRetold({ chapters: richChapters });
    const [a, b] = await Promise.all([retold.getRetold('Greenwich'), retold.getRetold('Greenwich')]);
    expect(a?.parts).toHaveLength(3);
    expect(b).toBe(a);
    expect(research).toHaveBeenCalledTimes(1);
  });

  test('a success is cached: the second open is free', async () => {
    const { retold, research } = loadRetold({ chapters: richChapters });
    await retold.getRetold('Greenwich');
    await retold.getRetold('Greenwich');
    expect(research).toHaveBeenCalledTimes(1);
  });
});

describe('the durable store (the cache that outlives the worker)', () => {
  const storedRetold = {
    parts: [{ heading: 'Stored', body: 'Another worker already told this.' }],
    minutes: 2,
    timeline: [],
  };

  test('a store hit spends NOTHING — no call, not even the article fetch', async () => {
    const { retold, research, getArticle } = loadRetold({
      chapters: richChapters,
      storedGet: jest.fn(async () => ({ value: { retold: storedRetold }, at: Date.now() })),
    });
    const answer = await retold.getRetold('Greenwich');
    expect(answer?.parts[0].heading).toBe('Stored');
    expect(research).not.toHaveBeenCalled();
    expect(getArticle).not.toHaveBeenCalled();
  });

  test("a stored 'no retelling' verdict is honoured across workers", async () => {
    const { retold, research, getArticle } = loadRetold({
      chapters: richChapters,
      storedGet: jest.fn(async () => ({ value: { retold: null }, at: Date.now() })),
    });
    expect(await retold.getRetold('Small Plaque')).toBeNull();
    expect(research).not.toHaveBeenCalled();
    expect(getArticle).not.toHaveBeenCalled();
  });

  test('a STALE store entry does not answer — the story is retold', async () => {
    const monthAndDayMs = 31 * 24 * 60 * 60 * 1000;
    const { retold, research } = loadRetold({
      chapters: richChapters,
      storedGet: jest.fn(async () => ({
        value: { retold: storedRetold },
        at: Date.now() - monthAndDayMs,
      })),
    });
    const answer = await retold.getRetold('Greenwich');
    expect(answer?.parts).toHaveLength(3); // the fresh generation, not the stale store
    expect(research).toHaveBeenCalledTimes(1);
  });

  test('a finished generation writes the store; a stub verdict does too', async () => {
    const { retold, storePut } = loadRetold({ chapters: richChapters });
    await retold.getRetold('Greenwich');
    expect(storePut).toHaveBeenCalledWith(
      'retold',
      'greenwich',
      expect.objectContaining({ retold: expect.objectContaining({ parts: expect.any(Array) }) }),
      expect.any(Number)
    );

    const stub = loadRetold({ chapters: stubChapters });
    await stub.retold.getRetold('Small Plaque');
    expect(stub.storePut).toHaveBeenCalledWith(
      'retold',
      'small plaque',
      { retold: null },
      expect.any(Number)
    );
  });
});
