import { parseRetold, retoldPrompt } from '@/server/retold';

describe('retoldPrompt (the long-form contract, scaled to its source)', () => {
  // Rich source: the full long-read ask
  const long = retoldPrompt('Greenwich', 'x'.repeat(6000));
  // 1,500-3,000 chars — the places the dropped gate newly admits. The
  // old fixed ask (6-9 parts, 1,200-1,800 words) aimed at THIS source
  // would be an instruction to invent.
  const short = retoldPrompt('Greenwich', 'x'.repeat(1700));

  test('a rich source carries the full organisation, honesty and length rules', () => {
    expect(long).toContain('6 to 9 parts');
    expect(long).toContain('most surprising true thing');
    expect(long).toContain('Use ONLY facts from the source text');
    expect(long).toContain('1,200-1,800 words');
    expect(long).toContain('copied EXACTLY');
    expect(long).toContain('4 to 6 pivotal dated moments');
  });

  test('a short source is asked for a SHORT original account, never a padded one', () => {
    expect(short).toContain('3 to 5 parts');
    expect(short).toContain('350-700 words');
    expect(short).toContain('2 to 4 pivotal dated moments');
    expect(short).toContain('Never pad');
    // The honesty rules do not scale away
    expect(short).toContain('Use ONLY facts from the source text');
    expect(short).toContain('most surprising true thing');
    // …and 3 parts still clears parseRetold's floor of 3
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

describe('parseRetold — the brief (the ten-second read above Part One)', () => {
  const parts = [
    { heading: 'A', body: 'One.' },
    { heading: 'B', body: 'Two.' },
    { heading: 'C', body: 'Three.' },
  ];

  test('two or three clean lines survive, trimmed', () => {
    const retold = parseRetold(
      JSON.stringify({
        brief: ['  The last surviving tea clipper. ', 'Nearly lost to fire in 2007.'],
        parts,
      })
    );
    expect(retold?.brief).toEqual([
      'The last surviving tea clipper.',
      'Nearly lost to fire in 2007.',
    ]);
  });

  test('a bad line drops; a fourth line is never kept', () => {
    const retold = parseRetold(
      JSON.stringify({
        brief: ['Real line one.', '   ', 42, 'Real line two.', 'x'.repeat(200), 'Line three.', 'Line four.'],
        parts,
      })
    );
    expect(retold?.brief).toEqual(['Real line one.', 'Real line two.', 'Line three.']);
  });

  test('one line is not a brief — and no brief never costs the retelling', () => {
    expect(parseRetold(JSON.stringify({ brief: ['Alone.'], parts }))?.brief).toEqual([]);
    expect(parseRetold(JSON.stringify({ brief: 'not an array', parts }))?.brief).toEqual([]);
    expect(parseRetold(JSON.stringify({ parts }))?.brief).toEqual([]);
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
