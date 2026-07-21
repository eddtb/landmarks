import { parseRetold, retoldPrompt } from '@/server/retold';

describe('retoldPrompt (the long-form contract)', () => {
  const prompt = retoldPrompt('Greenwich', 'Some source text.');

  test('carries the organisation, honesty and length rules', () => {
    expect(prompt).toContain('6 to 9 parts');
    expect(prompt).toContain('most surprising true thing');
    expect(prompt).toContain('Use ONLY facts from the source text');
    expect(prompt).toContain('1,200-1,800 words');
    expect(prompt).toContain('Some source text.');
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
