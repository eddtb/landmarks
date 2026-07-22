import {
  hookEchoesTitle,
  formatDistance,
  formatWalkTime,
  storyHook,
  storyParagraphs,
} from '@/utils/format';

describe('formatDistance', () => {
  test('shows meters below 1 km', () => {
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  test('shows kilometers with one decimal from 1 km', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(1240)).toBe('1.2 km');
  });
});

describe('formatWalkTime', () => {
  test('rounds to minutes with a 1-minute floor', () => {
    expect(formatWalkTime(20)).toBe('1 min walk');
    expect(formatWalkTime(73)).toBe('1 min walk');
    expect(formatWalkTime(260)).toBe('4 min walk');
    expect(formatWalkTime(900)).toBe('15 min walk');
  });
});

describe('storyHook', () => {
  test('takes the first sentence of the extract', () => {
    expect(
      storyHook(
        'JASON was a low-power nuclear research reactor. It was installed by the Ministry of Defence.'
      )
    ).toBe('JASON was a low-power nuclear research reactor.');
  });

  test('caps a rambling opening sentence', () => {
    const rambling = `${'history '.repeat(30)}ends.`;
    const hook = storyHook(rambling);
    expect(hook!.length).toBeLessThanOrEqual(160);
    expect(hook!.endsWith('…')).toBe(true);
  });

  test('handles missing extracts and ones with no full stop', () => {
    expect(storyHook(undefined)).toBeUndefined();
    expect(storyHook('A fragment without a full stop')).toBe('A fragment without a full stop');
  });

  test('strips the pronunciation parenthetical from the hook', () => {
    expect(storyHook('Cutty Sark (/ˌkʌti ˈsɑːrk/) is a British clipper ship. Built in 1869.')).toBe(
      'Cutty Sark is a British clipper ship.'
    );
  });
});

describe('storyParagraphs', () => {
  test('splits on newlines and trims', () => {
    expect(
      storyParagraphs(
        'The Greenwich Foot Tunnel crosses beneath the Thames.\nThe southern entrance is by the Cutty Sark.\n'
      )
    ).toEqual([
      'The Greenwich Foot Tunnel crosses beneath the Thames.',
      'The southern entrance is by the Cutty Sark.',
    ]);
  });

  test('strips IPA parentheticals but keeps ordinary ones like dates', () => {
    expect(
      storyParagraphs('Cutty Sark (/ˌkʌti ˈsɑːrk/) is a ship. Mary I was born there (1516).')
    ).toEqual(['Cutty Sark is a ship. Mary I was born there (1516).']);
  });
});

describe('hookEchoesTitle (a card must not say the same thing twice)', () => {
  test('a truncated plaque title is echoed by its own first sentence', () => {
    expect(
      hookEchoesTitle(
        'This Turkish bronze gun was cast in 1790-91 (AH 1212) in…',
        'This Turkish bronze gun was cast in 1790-91 (AH 1212) in the reign of Selim III.'
      )
    ).toBe(true);
  });

  test('identical title and hook echo (Gordon of Greenwich)', () => {
    expect(
      hookEchoesTitle('Gordon of Greenwich Loved Here ⭐️⭐️⭐️⭐️⭐️', 'Gordon of Greenwich Loved Here ⭐️⭐️⭐️⭐️⭐️')
    ).toBe(true);
  });

  test('a real hook that adds information is not an echo', () => {
    expect(
      hookEchoesTitle('Greenwich Foot Tunnel', 'The tunnel opened in 1902 and carried a million people a year.')
    ).toBe(false);
  });
});
