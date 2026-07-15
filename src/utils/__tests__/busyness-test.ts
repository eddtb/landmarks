import { BusynessPattern, DayPattern } from '@/types/busyness';
import { currentSlot, describeBusyness } from '@/utils/busyness';

describe('currentSlot', () => {
  test('maps JS Sunday-first days onto Monday-first weekdays', () => {
    // 2026-07-17 is a Friday; 2026-07-19 a Sunday
    expect(currentSlot(new Date(2026, 6, 17, 21, 0)).day).toBe('Friday');
    expect(currentSlot(new Date(2026, 6, 19, 10, 0)).day).toBe('Sunday');
  });

  test('maps hours onto bands', () => {
    expect(currentSlot(new Date(2026, 6, 17, 9, 0)).band).toBe('morning');
    expect(currentSlot(new Date(2026, 6, 17, 13, 0)).band).toBe('afternoon');
    expect(currentSlot(new Date(2026, 6, 17, 18, 30)).band).toBe('evening');
    expect(currentSlot(new Date(2026, 6, 17, 23, 0)).band).toBe('night');
  });
});

describe('describeBusyness', () => {
  const day = (overrides: Partial<DayPattern> = {}): DayPattern => ({
    morning: 'quiet',
    afternoon: 'moderate',
    evening: 'busy',
    night: 'packed',
    ...overrides,
  });
  const pattern: BusynessPattern = {
    pattern: {
      Monday: day(),
      Tuesday: day(),
      Wednesday: day(),
      Thursday: day(),
      Friday: day(),
      Saturday: day(),
      Sunday: day({ evening: 'quiet' }),
    },
  };

  test('speaks in "usually", never "now"', () => {
    const fridayNight = describeBusyness(pattern, new Date(2026, 6, 17, 22, 0));
    expect(fridayNight).toBe('Usually packed around this time');
    expect(fridayNight).not.toMatch(/now/);
  });

  test('reads the right slot for the moment', () => {
    expect(describeBusyness(pattern, new Date(2026, 6, 19, 18, 0))).toBe(
      'Usually quiet around this time'
    );
  });
});
