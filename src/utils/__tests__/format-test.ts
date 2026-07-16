import {
  closesSoonLabel,
  compactTimeRange,
  formatDistance,
  formatHoursLine,
  formatRating,
  formatRatingCount,
  formatWalkTime,
  openUntilLabel,
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
