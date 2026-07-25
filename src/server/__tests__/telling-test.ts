import { diskBackedMap } from '@/server/ai-cache';
import { getTelling, tellingPrompt } from '@/server/telling';

jest.mock('@/server/anthropic', () => ({
  research: jest.fn(),
}));
// The durable store: a miss by default (exactly a store that's off)
jest.mock('@/server/telling-store', () => ({
  storeGet: jest.fn(async () => undefined),
  storePut: jest.fn(),
}));

// The disk cache outlives the process BY DESIGN — which includes the
// last test run's debounced write. Start from a clean slate.
beforeAll(() => {
  diskBackedMap('tellings').clear();
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { research } = require('@/server/anthropic') as { research: jest.Mock };
const { storeGet, storePut } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/server/telling-store') as { storeGet: jest.Mock; storePut: jest.Mock };

const subject = {
  pageId: 9001,
  title: 'Borough Compter',
  extract: 'A small prison in Southwark, demolished in 1855.',
  source: 'Wikipedia',
};

describe('tellingPrompt (the voice contract)', () => {
  const prompt = tellingPrompt(subject);

  test('carries the subject and its source text', () => {
    expect(prompt).toContain('Borough Compter');
    expect(prompt).toContain('demolished in 1855');
    expect(prompt).toContain('Source (Wikipedia)');
  });

  test("encodes Edd's rules: hook first, no stage directions, no invention", () => {
    expect(prompt).toContain('most surprising true detail');
    expect(prompt).toContain('never assume the listener is at the site');
    expect(prompt).toContain('Use only facts in the source text');
  });
});

describe('getTelling', () => {
  beforeEach(() => {
    research.mockReset();
    research.mockResolvedValue('  In 1855 they tore it down.  ');
  });

  test('writes once, then serves from the cache', async () => {
    const first = await getTelling(subject);
    const second = await getTelling(subject);

    expect(first).toBe('In 1855 they tore it down.');
    expect(second).toBe(first);
    expect(research).toHaveBeenCalledTimes(1);
    // Ungrounded and modest: nothing here can ever bill a search
    expect(research).toHaveBeenCalledWith(
      expect.objectContaining({ grounded: false, maxTokens: 400 })
    );
  });

  test('areas cache by name, apart from any pageId', async () => {
    await getTelling({ ...subject, pageId: 0, title: 'Greenwich' }, 'area:greenwich');
    await getTelling({ ...subject, pageId: 0, title: 'Deptford' }, 'area:deptford');
    expect(research).toHaveBeenCalledTimes(2); // no collision on pageId 0
    await getTelling({ ...subject, pageId: 0, title: 'Greenwich' }, 'area:greenwich');
    expect(research).toHaveBeenCalledTimes(2); // second Greenwich from cache
  });

  test('an empty answer is not cached — the next press retries', async () => {
    research.mockResolvedValueOnce('');
    await expect(getTelling({ ...subject, pageId: 9002 })).resolves.toBe('');
    await getTelling({ ...subject, pageId: 9002 });
    expect(research).toHaveBeenCalledTimes(2);
  });

  test('the durable store answers before a call is spent — another worker already told it', async () => {
    storeGet.mockResolvedValueOnce({
      value: { text: 'Told on a worker that has since died.', at: 1 },
      at: Date.now() - 1000,
    });

    const text = await getTelling({ ...subject, pageId: 9003 });

    expect(text).toBe('Told on a worker that has since died.');
    expect(research).not.toHaveBeenCalled();
    // …and the next open of the SAME story never re-asks the store:
    // the hit re-seeded the per-process map
    storeGet.mockClear();
    await getTelling({ ...subject, pageId: 9003 });
    expect(storeGet).not.toHaveBeenCalled();
  });

  test('a STALE store entry does not answer — the story is retold and re-stored', async () => {
    const monthAndDayMs = 31 * 24 * 60 * 60 * 1000;
    storeGet.mockResolvedValueOnce({
      value: { text: 'Old words.', at: 1 },
      at: Date.now() - monthAndDayMs,
    });

    const text = await getTelling({ ...subject, pageId: 9004 });

    expect(text).toBe('In 1855 they tore it down.');
    expect(research).toHaveBeenCalledTimes(1);
    expect(storePut).toHaveBeenCalledWith(
      'telling',
      '9004',
      expect.objectContaining({ text: 'In 1855 they tore it down.' }),
      expect.any(Number)
    );
  });
});
