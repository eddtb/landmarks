import {
  parseBlurb,
  parseBusynessPattern,
  parsePlanAnnotations,
  parseWhatsOnEvents,
} from '@/server/anthropic';

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

describe('parseBlurb', () => {
  test('parses a blurb behind narration', () => {
    expect(
      parseBlurb(
        'Here is what I found: {"blurb": "An artist-run project space in the Fuel Tank studios on Creekside."}'
      )
    ).toBe('An artist-run project space in the Fuel Tank studios on Creekside.');
  });

  test('strips the citation tags the search tooling embeds', () => {
    expect(
      parseBlurb(
        '{"blurb": "<cite index=\\"2-1\\">A golf facility with 60 bays</cite> and <cite index=\\"2-13\\">views of the Thames</cite>."}'
      )
    ).toBe('A golf facility with 60 bays and views of the Thames.');
  });

  test('a decline is null, and so is anything unusable', () => {
    expect(parseBlurb('{"blurb": null}')).toBeNull();
    expect(parseBlurb('{"blurb": "Too short."}')).toBeNull();
    expect(parseBlurb(`{"blurb": "${'x'.repeat(500)}"}`)).toBeNull();
    expect(parseBlurb('I could not find anything reliable.')).toBeNull();
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


describe('parsePlanAnnotations', () => {
  test('parses title, whys, and leg notes around narration', () => {
    const parsed = parsePlanAnnotations(
      'Here is the JSON you asked for:\n{"title": "Golden hour to last orders", "whys": {"a1": "Catch the river light before dinner."}, "legNotes": {"1": "clear evening, worth the river path"}}\nHope that helps!'
    );
    expect(parsed?.title).toBe('Golden hour to last orders');
    expect(parsed?.whys.a1).toBe('Catch the river light before dinner.');
    expect(parsed?.legNotes['1']).toBe('clear evening, worth the river path');
  });

  test('rejects shapes without a title or whys', () => {
    expect(parsePlanAnnotations('{"whys": {}}')).toBeNull();
    expect(parsePlanAnnotations('no json at all')).toBeNull();
  });

  test('strips cite tags and clamps runaway lines', () => {
    const parsed = parsePlanAnnotations(
      `{"title": "T", "whys": {"a1": "<cite index=1>A fine pub</cite> ${'x'.repeat(200)}"}}`
    );
    expect(parsed?.whys.a1?.startsWith('A fine pub')).toBe(true);
    expect(parsed!.whys.a1!.length).toBeLessThanOrEqual(140);
  });
});
