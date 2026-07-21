import { linkifyParagraph } from '@/utils/linkify';

const candidates = [
  { title: 'Palace of Placentia', pageId: 1 },
  { title: 'Liberty of the Clink', pageId: 2 },
  { title: 'Greenwich', pageId: 3 }, // one word: never links
  { title: 'The Clink', pageId: 4 },
];

describe('linkifyParagraph (the web of history)', () => {
  test('a mentioned story becomes a door, once, at word boundaries', () => {
    const segments = linkifyParagraph(
      'Henry VIII was born at the Palace of Placentia. The Palace of Placentia stood by the river.',
      candidates
    );
    expect(segments.filter((segment) => segment.pageId === 1)).toHaveLength(1);
    expect(segments.map((segment) => segment.text).join('')).toBe(
      'Henry VIII was born at the Palace of Placentia. The Palace of Placentia stood by the river.'
    );
  });

  test('longer titles win their ground before shorter ones', () => {
    const segments = linkifyParagraph(
      'Prisoners were held at the Liberty of the Clink.',
      candidates
    );
    expect(segments.find((segment) => segment.pageId === 2)?.text).toBe('Liberty of the Clink');
    expect(segments.some((segment) => segment.pageId === 4)).toBe(false);
  });

  test('one-word titles never link — Greenwich would claim half the prose', () => {
    const segments = linkifyParagraph('Greenwich is full of Greenwich things.', candidates);
    expect(segments).toEqual([{ text: 'Greenwich is full of Greenwich things.' }]);
  });

  test('matching is case-insensitive but keeps the prose spelling', () => {
    const segments = linkifyParagraph('the palace of placentia was grand.', candidates);
    expect(segments.find((segment) => segment.pageId === 1)?.text).toBe('palace of placentia');
  });
});
