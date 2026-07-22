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

function loadRetold(options: { chapters: Chapter[] | null; researchImpl?: jest.Mock }) {
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
  jest.doMock('@/server/anthropic', () => ({ researchStream }));
  jest.doMock('@/server/article', () => ({ getArticle }));
  jest.doMock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const retold = require('@/server/retold') as typeof import('@/server/retold');
  return { retold, research: researchStream, getArticle };
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
