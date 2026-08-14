import { extractAnswerText, makeGeminiSseDecoder } from '@/server/gemini';

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
 * The cap only means something if every accepted call lands in the
 * ledger. The streaming transport already records the moment Gemini
 * accepts ("a stream cut short still burned a call"); the one-shot
 * transport used to record only after the body parsed, so a 200 whose
 * body died mid-read spent a quota unit the breaker never saw.
 */
describe('generateWithGemini spend recording', () => {
  test('a call Gemini accepted is recorded even when the body dies mid-read', async () => {
    const gemini =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/server/gemini') as typeof import('@/server/gemini');
    const { generateWithGemini, geminiBudget } = gemini;
    const before = geminiBudget.todays().calls;
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('socket died mid-body')),
    } as unknown as Response);
    try {
      await expect(
        generateWithGemini({
          apiKey: 'test-key',
          prompt: 'p',
          maxTokens: 10,
          grounded: false,
          label: 'test',
        })
      ).rejects.toThrow('socket died mid-body');

      expect(geminiBudget.todays().calls).toBe(before + 1);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
