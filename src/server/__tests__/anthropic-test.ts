import { parseBusynessPattern, parseWhatsOnEvents } from '@/server/anthropic';

describe('parseWhatsOnEvents', () => {
  test('parses a fenced JSON array of events', () => {
    const events = parseWhatsOnEvents(
      '```json\n[{"title": "Quiz night", "schedule": "Sundays 8pm", "detail": "£2 entry", "sourceUrl": "https://example.com/quiz"}]\n```'
    );

    expect(events).toEqual([
      {
        title: 'Quiz night',
        schedule: 'Sundays 8pm',
        detail: '£2 entry',
        sourceUrl: 'https://example.com/quiz',
      },
    ]);
  });

  test('finds the array behind narration the prompt asked the model not to write', () => {
    const events = parseWhatsOnEvents(
      'Based on the search results, I have found confirmed regular events. ```json\n' +
        '[{"title": "Quiz night", "schedule": "Sundays", "sourceUrl": "https://example.com"}]\n' +
        '``` Let me know if you need more.'
    );

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Quiz night');
  });

  test('omits detail when absent or empty', () => {
    const events = parseWhatsOnEvents(
      '[{"title": "Folk night", "schedule": "Wednesdays", "sourceUrl": "https://example.com"}]'
    );
    expect(events[0]).toEqual({
      title: 'Folk night',
      schedule: 'Wednesdays',
      sourceUrl: 'https://example.com',
    });
  });

  test('drops events without a source or with a non-https source', () => {
    const events = parseWhatsOnEvents(
      JSON.stringify([
        { title: 'No source', schedule: 'Mondays' },
        { title: 'Insecure', schedule: 'Tuesdays', sourceUrl: 'http://example.com' },
        { title: 'Kept', schedule: 'Fridays', sourceUrl: 'https://example.com' },
      ])
    );

    expect(events).toHaveLength(1);
    expect(events[0].title).toBe('Kept');
  });

  test('caps the list at four events', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      title: `Event ${index}`,
      schedule: 'Weekly',
      sourceUrl: 'https://example.com',
    }));
    expect(parseWhatsOnEvents(JSON.stringify(many))).toHaveLength(4);
  });

  test('returns nothing for prose, malformed JSON, or non-arrays', () => {
    expect(parseWhatsOnEvents('No regular events found.')).toEqual([]);
    expect(parseWhatsOnEvents('[{"title": "Broken"')).toEqual([]);
    expect(parseWhatsOnEvents('{"title": "Object"}')).toEqual([]);
    expect(parseWhatsOnEvents('')).toEqual([]);
  });
});

describe('parseBusynessPattern', () => {
  const fullWeek = (level: string) =>
    Object.fromEntries(
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
        (day) => [
          day,
          { morning: level, afternoon: level, evening: level, night: level },
        ]
      )
    );

  test('parses a complete week, even behind narration', () => {
    const parsed = parseBusynessPattern(
      'Here is my estimate: ' + JSON.stringify({ pattern: fullWeek('busy'), note: 'Quiz spike' })
    );

    expect(parsed?.pattern.Friday.evening).toBe('busy');
    expect(parsed?.note).toBe('Quiz spike');
  });

  test('rejects a pattern with a missing day', () => {
    const pattern = fullWeek('quiet');
    delete (pattern as Record<string, unknown>).Sunday;
    expect(parseBusynessPattern(JSON.stringify({ pattern }))).toBeNull();
  });

  test('rejects a pattern with an unknown level', () => {
    const pattern = fullWeek('moderate');
    (pattern.Friday as Record<string, string>).night = 'heaving';
    expect(parseBusynessPattern(JSON.stringify({ pattern }))).toBeNull();
  });

  test('rejects prose and malformed JSON', () => {
    expect(parseBusynessPattern('It will probably be busy on Friday.')).toBeNull();
    expect(parseBusynessPattern('{"pattern": {')).toBeNull();
  });
});

