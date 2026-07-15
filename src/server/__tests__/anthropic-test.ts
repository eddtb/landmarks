import { parseTodayEvents, parseWhatsOnEvents } from '@/server/anthropic';

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

describe('parseTodayEvents', () => {
  test('parses events behind narration, keeping only complete sourced ones', () => {
    const events = parseTodayEvents(
      'I found several things on today. ```json\n' +
        JSON.stringify([
          {
            title: 'Live music',
            venue: 'Trafalgar Tavern',
            time: 'Evening',
            sourceUrl: 'https://www.trafalgartavern.co.uk/whats-on',
          },
          { title: 'No venue', time: '8pm', sourceUrl: 'https://example.com' },
          { title: 'No source', venue: 'Somewhere', time: '9pm' },
          {
            title: 'Insecure',
            venue: 'Elsewhere',
            time: '7pm',
            sourceUrl: 'http://example.com',
          },
        ]) +
        '\n```'
    );

    expect(events).toEqual([
      {
        title: 'Live music',
        venue: 'Trafalgar Tavern',
        time: 'Evening',
        sourceUrl: 'https://www.trafalgartavern.co.uk/whats-on',
      },
    ]);
  });

  test('caps the list at twelve events', () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      title: `Event ${index}`,
      venue: 'Venue',
      time: 'All day',
      sourceUrl: 'https://example.com',
    }));
    expect(parseTodayEvents(JSON.stringify(many))).toHaveLength(12);
  });

  test('returns nothing for prose or malformed JSON', () => {
    expect(parseTodayEvents('Nothing much on today.')).toEqual([]);
    expect(parseTodayEvents('[{"title": "Broken"')).toEqual([]);
  });
});
