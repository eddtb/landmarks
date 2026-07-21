import { diskBackedMap } from '@/server/ai-cache';
import { getTelling, tellingPrompt } from '@/server/telling';

jest.mock('@/server/anthropic', () => ({
  research: jest.fn(),
}));

// The disk cache outlives the process BY DESIGN — which includes the
// last test run's debounced write. Start from a clean slate.
beforeAll(() => {
  diskBackedMap('tellings').clear();
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { research } = require('@/server/anthropic') as { research: jest.Mock };

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
});
