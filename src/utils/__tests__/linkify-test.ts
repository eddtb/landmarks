import { linkifyParagraph, planStoryLinks } from '@/utils/linkify';

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

describe('planStoryLinks (a door opens once per story)', () => {
  const parts = [
    ['Henry was born at the Palace of Placentia.', 'The Liberty of the Clink lay south.'],
    ['The Palace of Placentia grew.', 'Prisoners filled the Liberty of the Clink.'],
    ['The Palace of Placentia fell.'],
  ];

  test('each title is allowed only at its FIRST mention across the whole story', () => {
    const plan = planStoryLinks(parts, candidates);
    expect(plan[0][0].map((c) => c.pageId)).toEqual([1]); // Placentia: part 1, para 1
    // Both Clink titles first-match here (one contains the other) —
    // the render layer's longest-first pass keeps only one door
    expect(plan[0][1].map((c) => c.pageId)).toEqual([2, 4]);
    expect(plan[1][0]).toEqual([]); // later mentions are prose, not doors
    expect(plan[1][1]).toEqual([]);
    expect(plan[2][0]).toEqual([]);
  });

  test('overlapping planned titles still render as a single door', () => {
    const plan = planStoryLinks(parts, candidates);
    const segments = linkifyParagraph(parts[0][1], plan[0][1]);
    expect(segments.filter((segment) => segment.pageId !== undefined)).toHaveLength(1);
    expect(segments.find((segment) => segment.pageId === 2)?.text).toBe('Liberty of the Clink');
  });

  test('one-word titles never enter the plan', () => {
    const plan = planStoryLinks([['Greenwich everywhere.']], candidates);
    expect(plan[0][0]).toEqual([]);
  });

  test('the plan is shaped like the story even when nothing matches', () => {
    const plan = planStoryLinks([['nothing here'], ['or here', 'or here']], candidates);
    expect(plan).toEqual([[[]], [[], []]]);
  });
});
