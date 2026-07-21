import { parseRetold, retoldPrompt } from '@/server/retold';

describe('retoldPrompt (the long-form contract)', () => {
  const prompt = retoldPrompt('Greenwich', 'Some source text.');

  test('carries the organisation, honesty and length rules', () => {
    expect(prompt).toContain('6 to 9 parts');
    expect(prompt).toContain('most surprising true thing');
    expect(prompt).toContain('Use ONLY facts from the source text');
    expect(prompt).toContain('1,200-1,800 words');
    expect(prompt).toContain('copied EXACTLY');
    expect(prompt).toContain('timeline');
    expect(prompt).toContain('Some source text.');
  });
});

describe('parseRetold — pull-quotes and the timeline', () => {
  const base = {
    parts: [
      { heading: 'A', body: 'The palace stood here. It was grand.', pullQuote: 'The palace stood here.' },
      { heading: 'B', body: 'Second part text.', pullQuote: 'A sentence that appears nowhere.' },
      { heading: 'C', body: 'Third part.' },
    ],
    timeline: [
      { year: '1491', label: 'Henry VIII born here', part: 1 },
      { year: '1670s', label: 'The Observatory rises', part: 3 },
      { year: 'not-a-year', label: 'Bad stop', part: 1 },
      { year: '1900', label: 'Anchored beyond the parts', part: 9 },
    ],
  };

  test('a verbatim pull-quote survives; an invented one is dropped, never rendered', () => {
    const retold = parseRetold(JSON.stringify(base));
    expect(retold?.parts[0].pullQuote).toBe('The palace stood here.');
    expect(retold?.parts[1].pullQuote).toBeUndefined();
    expect(retold?.parts[2].pullQuote).toBeUndefined();
  });

  test('punctuation cosmetics may drift; the words may not', () => {
    const retold = parseRetold(
      JSON.stringify({
        parts: [
          { heading: 'A', body: "It was Britain's finest clipper, and the fastest.", pullQuote: 'It was Britain’s finest clipper — and the fastest' },
          { heading: 'B', body: 'Second.', pullQuote: 'x' },
          { heading: 'C', body: 'Third.' },
        ],
      })
    );
    expect(retold?.parts[0].pullQuote).toBe('It was Britain’s finest clipper — and the fastest');
    expect(retold?.parts[1].pullQuote).toBeUndefined(); // different words still die
  });

  test('timeline stops must be dated, brief and anchored to a real part', () => {
    const retold = parseRetold(JSON.stringify(base));
    expect(retold?.timeline).toEqual([
      { year: '1491', label: 'Henry VIII born here', part: 1 },
      { year: '1670s', label: 'The Observatory rises', part: 3 },
    ]);
  });

  test('no timeline at all is fine — the story stands alone', () => {
    const retold = parseRetold(JSON.stringify({ parts: base.parts }));
    expect(retold?.timeline).toEqual([]);
  });
});

describe('parseRetold', () => {
  test('validates and counts a good retelling', () => {
    const retold = parseRetold(
      JSON.stringify({
        parts: [
          { heading: 'Birthplace of Royalty', body: `${'word '.repeat(230)}end.` },
          { heading: 'Viking Shadows', body: 'Second part.\n\nWith two paragraphs.' },
          { heading: 'The Meridian', body: 'Third part.' },
        ],
      })
    );
    expect(retold?.parts).toHaveLength(3);
    expect(retold?.minutes).toBe(1);
    expect(retold?.parts[0].heading).toBe('Birthplace of Royalty');
  });

  test('an unorganised retelling is not the product', () => {
    expect(parseRetold(JSON.stringify({ parts: [{ heading: 'One', body: 'Only.' }] }))).toBeNull();
    expect(parseRetold(JSON.stringify({ parts: 'not an array' }))).toBeNull();
    expect(parseRetold('not json at all')).toBeNull();
    expect(
      parseRetold(
        JSON.stringify({ parts: [{ heading: '', body: 'x' }, { heading: 'B', body: 'y' }, { heading: 'C', body: 'z' }] })
      )
    ).toBeNull(); // empty headings never render
  });
});
