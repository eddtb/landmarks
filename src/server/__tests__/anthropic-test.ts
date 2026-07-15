import { parseWhatsOnEvents } from '@/server/anthropic';

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
