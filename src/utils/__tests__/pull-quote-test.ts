import { withoutPullQuote } from '@/utils/pull-quote';

describe('withoutPullQuote (the highlight is not a repeat)', () => {
  const paragraphs = [
    'The palace stood here. It was grand beyond measure. Kings were born in it.',
    'Later it fell to ruin. Nothing remains today.',
  ];

  test('the quoted sentence leaves the body — highlight replaces origin', () => {
    const result = withoutPullQuote(paragraphs, 'It was grand beyond measure.');
    expect(result[0]).toBe('The palace stood here. Kings were born in it.');
    expect(result[1]).toBe(paragraphs[1]);
  });

  test('cosmetic drift still matches: curly quotes, case, trailing punctuation', () => {
    const result = withoutPullQuote(
      ['He called it ‘the king’s folly’. The court agreed.'],
      "He called it 'the King's folly'"
    );
    expect(result).toEqual(['The court agreed.']);
  });

  test('a quote that IS the whole paragraph removes the paragraph', () => {
    const result = withoutPullQuote(['Standalone sentence.', 'Another paragraph.'], 'Standalone sentence.');
    expect(result).toEqual(['Another paragraph.']);
  });

  test('no match, no quote: paragraphs pass through untouched', () => {
    expect(withoutPullQuote(paragraphs, 'A sentence from nowhere.')).toEqual(paragraphs);
    expect(withoutPullQuote(paragraphs, undefined)).toEqual(paragraphs);
  });

  test('only the first occurrence is removed', () => {
    const twice = ['It was grand. Truly.', 'It was grand. Again.'];
    const result = withoutPullQuote(twice, 'It was grand.');
    expect(result).toEqual(['Truly.', 'It was grand. Again.']);
  });
});
