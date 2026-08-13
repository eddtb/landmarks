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
