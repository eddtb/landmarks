import {
  closesSoonLabel,
  compactTimeRange,
  formatDistance,
  formatHoursLine,
  formatRating,
  formatRatingCount,
  formatWalkTime,
  historyTag,
  opensLabel,
  liveOpenNow,
  openUntilLabel,
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

describe('formatRating', () => {
  test('always shows one decimal', () => {
    expect(formatRating(4.5)).toBe('★ 4.5');
    expect(formatRating(4)).toBe('★ 4.0');
  });
});

describe('closesSoonLabel', () => {
  const now = new Date('2026-07-15T21:00:00Z');

  test('warns inside the one-hour window', () => {
    expect(closesSoonLabel('2026-07-15T21:40:00Z', now)).toBe('Closes in 40 min');
    expect(closesSoonLabel('2026-07-15T22:00:00Z', now)).toBe('Closes in 60 min');
  });

  test('quiet outside the window or after closing', () => {
    expect(closesSoonLabel('2026-07-15T23:00:00Z', now)).toBeNull();
    expect(closesSoonLabel('2026-07-15T20:30:00Z', now)).toBeNull();
  });

  test('quiet on malformed timestamps', () => {
    expect(closesSoonLabel('not-a-date', now)).toBeNull();
  });
});

describe('openUntilLabel', () => {
  test('formats device-local closing time, minutes only when odd', () => {
    // Assert structure, not a specific hour — CI and laptops disagree on timezone
    expect(openUntilLabel('2026-07-15T23:00:00Z')).toMatch(/^Open until \d{1,2}(am|pm)$/);
    expect(openUntilLabel('2026-07-15T22:30:00Z')).toMatch(/^Open until \d{1,2}:30(am|pm)$/);
  });

  test('quiet on malformed timestamps', () => {
    expect(openUntilLabel('not-a-date')).toBeNull();
  });
});

describe('opensLabel', () => {
  const now = new Date(2026, 6, 17, 9, 0); // Friday 9am, local time

  test('within the hour: worth waiting for', () => {
    expect(opensLabel(new Date(2026, 6, 17, 9, 20).toISOString(), now)).toBe('Opens in 20 min');
  });

  test('later today: Google-style opens time', () => {
    expect(opensLabel(new Date(2026, 6, 17, 17, 0).toISOString(), now)).toBe(
      'Closed · Opens 5pm'
    );
    expect(opensLabel(new Date(2026, 6, 17, 17, 30).toISOString(), now)).toBe(
      'Closed · Opens 5:30pm'
    );
  });

  test('another day gets the day name', () => {
    expect(opensLabel(new Date(2026, 6, 18, 9, 0).toISOString(), now)).toBe(
      'Closed · Opens Sat 9am'
    );
  });

  test('past or malformed moments are null', () => {
    expect(opensLabel(new Date(2026, 6, 17, 8, 0).toISOString(), now)).toBeNull();
    expect(opensLabel('not-a-date', now)).toBeNull();
  });
});

describe('formatHoursLine', () => {
  test("compacts Google's verbose weekday lines", () => {
    expect(formatHoursLine('Monday: 11:00 AM – 11:00 PM')).toBe('Mon 11am–11pm');
    expect(formatHoursLine('Friday: 9:30 AM – 5:00 PM')).toBe('Fri 9:30am–5pm');
    expect(formatHoursLine('Sunday: Closed')).toBe('Sun Closed');
    expect(formatHoursLine('Saturday: Open 24 hours')).toBe('Sat 24 hours');
  });
});

describe('compactTimeRange', () => {
  test('handles the bare first time Google writes', () => {
    expect(compactTimeRange('12:00 – 9:00 PM')).toBe('12–9pm');
  });
});

describe('formatRatingCount', () => {
  test('plain numbers below a thousand', () => {
    expect(formatRatingCount(7)).toBe('7');
    expect(formatRatingCount(847)).toBe('847');
  });

  test('compact thousands, trimming trailing .0', () => {
    expect(formatRatingCount(1000)).toBe('1k');
    expect(formatRatingCount(2310)).toBe('2.3k');
    expect(formatRatingCount(68411)).toBe('68.4k');
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

describe('historyTag', () => {
  test('reads the record, never invents', () => {
    expect(historyTag('The palace was demolished in the 17th century.')).toBe(
      'No longer standing'
    );
    expect(historyTag('The theatre building was torn down for the railway.')).toBe(
      'No longer standing'
    );
    expect(historyTag('A nuclear reactor ran here until 1996.')).toBe('Hidden history');
    expect(historyTag(undefined)).toBe('Hidden history');
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

describe('liveOpenNow', () => {
  test('a venue past its closing time reads closed, even from a stale snapshot', () => {
    const place = { openNow: true, nextCloseTime: '2026-07-18T15:00:00Z' };
    expect(liveOpenNow(place, new Date('2026-07-18T15:20:00Z'))).toBe(false);
    expect(liveOpenNow(place, new Date('2026-07-18T14:40:00Z'))).toBe(true);
  });

  test('a venue past its opening time reads open', () => {
    const place = { openNow: false, nextOpenTime: '2026-07-18T11:00:00Z' };
    expect(liveOpenNow(place, new Date('2026-07-18T11:05:00Z'))).toBe(true);
    expect(liveOpenNow(place, new Date('2026-07-18T10:00:00Z'))).toBe(false);
  });

  test('unknown hours stay unknown', () => {
    expect(liveOpenNow({}, new Date())).toBeUndefined();
  });
});
