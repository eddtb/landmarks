import {
  stripEmphasis,
  hookEchoesTitle,
  formatDistance,
  formatWalkTime,
  formatWalkTimeForMeters,
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

describe('formatWalkTimeForMeters', () => {
  test('converts meters at walking pace (1.33 m/s)', () => {
    // The sparse horizon's own number: 3000m is the "~38 min walk"
    expect(formatWalkTimeForMeters(3000)).toBe('38 min walk');
    expect(formatWalkTimeForMeters(1500)).toBe('19 min walk');
    expect(formatWalkTimeForMeters(50)).toBe('1 min walk');
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

  test('does not truncate at abbreviations', () => {
    expect(
      storyHook("St. Paul's Cathedral is an Anglican cathedral in London. It sits on Ludgate Hill.")
    ).toBe("St. Paul's Cathedral is an Anglican cathedral in London.");
    expect(
      storyHook('The house at No. 10 was rebuilt c. 1735 by Mr. Kent for Mrs. Walpole. It stands.')
    ).toBe('The house at No. 10 was rebuilt c. 1735 by Mr. Kent for Mrs. Walpole.');
    expect(storyHook('Dr. Johnson lived here. His dictionary was written upstairs.')).toBe(
      'Dr. Johnson lived here.'
    );
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

describe('formatDaySince (the journal speaks in days)', () => {
  // A Monday noon — weekday math needs a fixed anchor
  const monday = new Date('2026-07-27T12:00:00').getTime();
  const days = (n: number) => monday - n * 24 * 60 * 60 * 1000;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { formatDaySince } = require('@/utils/format') as typeof import('@/utils/format');

  test('today and yesterday are words, not dates', () => {
    expect(formatDaySince(monday - 60_000, monday)).toBe('today');
    expect(formatDaySince(days(1), monday)).toBe('yesterday');
  });

  test('inside the week it is a weekday; beyond, a date', () => {
    expect(formatDaySince(days(5), monday)).toBe('Wednesday');
    expect(formatDaySince(days(10), monday)).toBe('17 July');
  });

  test('late last night is still yesterday, not "13 hours ago" math', () => {
    const lateLastNight = new Date('2026-07-26T23:30:00').getTime();
    expect(formatDaySince(lateLastNight, monday)).toBe('yesterday');
  });
});

describe('stripEmphasis', () => {
  test('flattens the italicised titles the model sneaks in', () => {
    // Verbatim from a cached retelling, caught rendering its asterisks
    expect(stripEmphasis('*Sherlock Holmes* (2009) and *Thor: The Dark World*')).toBe(
      'Sherlock Holmes (2009) and Thor: The Dark World'
    );
    expect(stripEmphasis('a **bold claim** indeed')).toBe('a bold claim indeed');
  });

  test('leaves honest asterisks and clean prose alone', () => {
    expect(stripEmphasis('A palace stood here.')).toBe('A palace stood here.');
    expect(stripEmphasis('rated * by nobody')).toBe('rated * by nobody');
  });
});
