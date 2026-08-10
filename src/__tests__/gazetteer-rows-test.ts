import {
  buildGazetteerRows,
  emptyGazetteerCopy,
  emptyVerdict,
  partRowIndex,
} from '@/components/area-gazetteer';
import { HistoryItem } from '@/types/history';
import { Retold } from '@/types/retold';

const relic = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract: 'Some record.',
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
});

/** A real Open Plaques entry that never matched an article: 23 Brook
 * Street, Mayfair, erected by English Heritage in 1997. */
const hendrixPlaque: HistoryItem = {
  pageId: 3_000_000_595,
  title: 'Jimi Hendrix',
  coordinates: { latitude: 51.51302, longitude: -0.14609 },
  distanceMeters: 480,
  extract: 'Jimi Hendrix 1942-1970 guitarist and songwriter lived here 1968-1969',
  url: 'https://openplaques.org/plaques/595',
  source: 'Open Plaques',
};

/** The Grade II telephone kiosks in Broad Court, Covent Garden: the
 * register holds a grade and a point, and nothing anyone can read. */
const kiosks: HistoryItem = {
  pageId: 2_001_066_301,
  title: 'Telephone Kiosks, Broad Court',
  coordinates: { latitude: 51.5135, longitude: -0.1221 },
  distanceMeters: 240,
  url: 'https://historicengland.org.uk/listing/the-list/list-entry/1066301',
  source: 'Historic England · Grade II',
};

/** Bow Street: a name, a pin, and nothing written under either. */
const bowStreet: HistoryItem = {
  pageId: 1_234,
  title: 'Bow Street',
  coordinates: { latitude: 51.5132, longitude: -0.1224 },
  distanceMeters: 320,
  url: 'https://en.wikipedia.org/wiki/Bow_Street',
  source: 'Wikipedia',
};

const retold: Retold = {
  minutes: 7,
  brief: [],
  timeline: [
    { year: '1491', label: 'Henry VIII born here', part: 2 },
    { year: '1851', label: 'The Meridian established', part: 3 },
  ],
  parts: [
    { heading: 'Birthplace of Kings', body: 'One.' },
    { heading: 'Tudor Favorite', body: 'Two.' },
    { heading: 'The Meridian', body: 'Three.' },
  ],
};

describe('buildGazetteerRows', () => {
  test('ready: label, timeline, parts, link out — then the ground', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      relics: [relic(1, 'Palace of Placentia')],
    });
    // The label is a BYLINE now — under the piece, above the citation.
    // It used to lead the screen, so the first line of every retold place
    // announced it as AI output over a web page.
    expect(rows.map((row) => row.kind)).toEqual([
      'timeline',
      'part',
      'part',
      'part',
      'ai-label',
      'source-link',
      'section',
      'relic',
    ]);
  });

  test('a brief leads everything — and an empty one adds no row', () => {
    // The ten-second read (Edd, 2026-08-06): purely additive, above the
    // timeline and Part One; everything below keeps its exact order
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold: { ...retold, brief: ['The last tea clipper.', 'Dry-docked here since 1954.'] },
      relics: [],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'brief',
      'timeline',
      'part',
      'part',
      'part',
      'ai-label',
      'source-link',
    ]);
    const briefRow = rows[0];
    expect(briefRow.kind === 'brief' && briefRow.lines).toEqual([
      'The last tea clipper.',
      'Dry-docked here since 1954.',
    ]);
  });

  test('pending shows the shimmer; no retelling shows OUR story and cites the source', () => {
    const pending = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'pending',
      retold: null,
      relics: [],
    });
    expect(pending.map((row) => row.kind)).toEqual(['retelling-pending']);

    const failed = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
    });
    // Never the source article's body. Eleven of the twenty nearest
    // Greenwich places fall under the 3,000-char retelling gate, so this
    // branch was republishing Wikipedia verbatim on the MAJORITY of
    // screens — which is what App Review kept citing 4.2.2 for.
    expect(failed.map((row) => row.kind)).toEqual(['source-link']);
  });

  test('streaming: the label lands with the first part; the story grows part by part', () => {
    const nothingYet = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'streaming',
      retold: null,
      streamedParts: [],
      relics: [],
    });
    expect(nothingYet.map((row) => row.kind)).toEqual(['retelling-pending']);

    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'streaming',
      retold: null,
      streamedParts: retold.parts.slice(0, 2),
      relics: [relic(1, 'Palace of Placentia')],
    });
    // No timeline, no link out — both are end-of-telling business
    expect(rows.map((row) => row.kind)).toEqual([
      'ai-label',
      'part',
      'part',
      'retelling-pending',
      'section',
      'relic',
    ]);
  });

  test('halted: what arrived stays, and the rest is offered — words, not silence', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'halted',
      retold: null,
      streamedParts: retold.parts.slice(0, 1),
      relics: [],
    });
    expect(rows.map((row) => row.kind)).toEqual(['ai-label', 'part', 'retelling-halted']);

    // Halted before anything arrived: our story stands, source cited
    const nothing = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'halted',
      retold: null,
      streamedParts: [],
      relics: [],
    });
    expect(nothing.map((row) => row.kind)).toEqual(['source-link']);
  });

  test('a place with a telling to hand: the telling IS the story, then the citation', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      tellingLead: true,
    });
    expect(rows.map((row) => row.kind)).toEqual(['telling-lead', 'source-link']);
  });

  test('a halted-before-anything retelling gets the same treatment', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'halted',
      retold: null,
      streamedParts: [],
      relics: [],
      tellingLead: true,
    });
    expect(rows.map((row) => row.kind)).toEqual(['telling-lead', 'source-link']);
  });

  test('no row anywhere renders the source article body', () => {
    // The rule, fenced: whatever the state, the app shows its own writing
    // and a citation — never a copy of the page it read
    for (const retoldStatus of ['pending', 'streaming', 'ready', 'halted', 'none'] as const) {
      const rows = buildGazetteerRows({
        hasArticle: true,
        retoldStatus,
        retold: retoldStatus === 'ready' ? { parts: [], minutes: 1, timeline: [], brief: [] } : null,
        relics: [],
        tellingLead: true,
      });
      expect(rows.map((row) => row.kind)).not.toContain('fallback-article');
    }
  });

  test('a READY retelling never doubles up with a telling lead', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      relics: [],
      tellingLead: true,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'timeline',
      'part',
      'part',
      'part',
      'ai-label',
      'source-link',
    ]);
  });

  test('no article: the relics stand alone, immediately', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      retoldStatus: 'pending',
      retold: null,
      relics: [relic(1, 'Palace of Placentia'), relic(2, 'JASON reactor')],
    });
    expect(rows.map((row) => row.kind)).toEqual(['section', 'relic', 'relic']);
  });

  test('a story probed and MISSING leads the relics with words, not silence', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [relic(1, 'Palace of Placentia')],
    });
    expect(rows.map((row) => row.kind)).toEqual(['no-story', 'section', 'relic']);
  });

  test('a missing story with no relics leaves the list empty — its empty state speaks', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
    });
    expect(rows).toEqual([]);
  });

  test('a named area says its NAME above its relics, not "this area"', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [relic(1, 'Theatre Royal, Covent Garden')],
      name: 'Covent Garden',
    });
    expect(rows[0]).toEqual({
      kind: 'no-story',
      key: 'no-story',
      copy: 'No story of Covent Garden is written down yet — but its ground is not empty.',
    });
  });
});

/**
 * Direction C — "Thin ground, and where it thickens" (#292). A PLACE
 * whose article never resolved: one measured grey line about how much
 * the records hold, then the neighbourhood. The dead end becomes a
 * junction, and the screen names itself throughout.
 */
describe('buildGazetteerRows: a place with no article of its own', () => {
  const nearby = [
    relic(11, 'Bow Street Magistrates’ Court'),
    relic(12, 'Royal Opera House'),
    relic(13, 'St Paul’s, Covent Garden'),
    relic(14, 'Seven Dials'),
  ];

  test('no article, no relics, no extract — the screen that rendered BLANK', () => {
    // Three buttons and a back chevron, and not one row beneath them:
    // relics={[]} withheld the no-story row, no article withheld the
    // citation, and the list's own empty copy sat behind an `empty`
    // element that rendered nothing. This is that exact case.
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      name: 'Bow Street',
      record: bowStreet,
    });
    expect(rows.map((row) => row.kind)).toEqual(['no-story', 'source-link']);
    expect(rows[0]).toMatchObject({
      // No neighbourhood to point at, so no claim is made about one
      copy: 'A name and a pin, and nothing written under either.',
    });
  });

  test('…and with a neighbourhood, the dead end becomes a junction', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      name: 'Bow Street',
      record: bowStreet,
      nearby,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'no-story',
      'section',
      'relic',
      'relic',
      'relic',
      'source-link',
    ]);
    expect(rows[0]).toMatchObject({
      copy: 'A name and a pin, and nothing written under either. The ground around it is better recorded.',
    });
    // Three places worth the next ten minutes — not the whole feed
    expect(rows[1]).toMatchObject({ kind: 'section', title: 'Also within a walk · 3' });
    expect(rows.filter((row) => row.kind === 'relic')).toHaveLength(3);
  });

  test('a plaque: its own words first, then the measurement, then the ground', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      name: 'Jimi Hendrix',
      record: hendrixPlaque,
      nearby: nearby.slice(0, 2),
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'record-story',
      'no-story',
      'section',
      'relic',
      'relic',
      'source-link',
    ]);
    expect(rows[1]).toMatchObject({
      copy: 'The plaque is the whole record — no article stands behind it.',
    });
  });

  test('a listed building: the register holds a grade and a point, and says so', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      name: 'Telephone Kiosks, Broad Court',
      record: kiosks,
    });
    // No extract at all, so no record story — and an empty section is a
    // correct answer
    expect(rows.map((row) => row.kind)).toEqual(['no-story', 'source-link']);
    expect(rows[0]).toMatchObject({
      copy: 'Historic England holds the grade and the position. Nobody has written the rest down.',
    });
  });

  test('a record with its own words claims nothing about what nobody wrote', () => {
    // A failed article fetch is not evidence that the record is empty —
    // this extract IS the record, and it is on the screen
    const rows = buildGazetteerRows({
      hasArticle: false,
      storyMissing: true,
      retoldStatus: 'none',
      retold: null,
      relics: [],
      name: 'Borough Compter',
      record: { ...bowStreet, extract: 'A small compter in Southwark, demolished in 1855.' },
    });
    expect(rows.map((row) => row.kind)).toEqual(['record-story', 'source-link']);
  });

  test('a HEALTHY screen is untouched — a direction that changes it changes the wrong thing', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      relics: [],
      name: 'St Paul’s, Covent Garden',
      record: hendrixPlaque,
      nearby,
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'timeline',
      'part',
      'part',
      'part',
      'ai-label',
      'source-link',
    ]);
  });
});

/**
 * The empty LADDER, exhaustively — the structural half of #255. The bug
 * was never about ExtractStory: it was that the branch consulted a
 * ReactNode a caller handed in, and an element that renders null is
 * still truthy, so the default was unreachable for ANY such caller.
 *
 * The fence is the signature. `emptyVerdict` takes no node, so no
 * caller can stand in front of the default; and the table below covers
 * every state it can be asked about, so "the default is reachable"
 * stops being something anyone has to remember.
 */
describe('the empty ladder', () => {
  const states = ['pending', 'ready', 'none'] as const;

  test.each(states.flatMap((status) => [true, false].map((hasArticle) => ({ status, hasArticle }))))(
    'articleStatus=$status, hasArticle=$hasArticle → a verdict, never a caller’s element',
    ({ status, hasArticle }) => {
      expect(['nothing', 'waiting', 'default']).toContain(emptyVerdict(status, hasArticle));
    }
  );

  test('an article carries the screen: the list stays quiet under a hero', () => {
    for (const status of states) {
      expect(emptyVerdict(status, true)).toBe('nothing');
    }
  });

  test('no article, still probing: the spinner, never a premature verdict', () => {
    expect(emptyVerdict('pending', false)).toBe('waiting');
  });

  test('no article, settled: the DEFAULT — the branch that could not be reached', () => {
    // This is the whole of #255. Both settled statuses land here: an
    // article that answered nothing, and a probe that never had a name
    // to ask about (#217's mid-sea).
    expect(emptyVerdict('none', false)).toBe('default');
    expect(emptyVerdict('ready', false)).toBe('default');
  });

  test('the default is reachable from every settled state there is', () => {
    const settled = states.filter((status) => status !== 'pending');
    expect(settled.map((status) => emptyVerdict(status, false))).toEqual(
      settled.map(() => 'default')
    );
  });
});

describe('the empty copy, reachable at last', () => {
  test('names the place, and the control it points at', () => {
    expect(emptyGazetteerCopy('Cudham')).toBe(
      'Nothing is written down within a walk of Cudham. Walk on, or tap the name above to look somewhere else.'
    );
  });

  test('mid-sea, with no name to use, it still invites rather than apologises', () => {
    expect(emptyGazetteerCopy(null)).toBe(
      'Nothing is written down within a walk. Walk on, or tap the name above to look somewhere else.'
    );
  });
});

/**
 * The reader-facing invariant the ladder exists to hold: for every
 * shape a story screen can take, the list either has rows or the
 * default copy is what fills it. Never neither — "neither" is the blank
 * screen with three buttons that #292 was filed for.
 */
describe('a settled screen is never blank', () => {
  const shapes: { what: string; options: Parameters<typeof buildGazetteerRows>[0] }[] = [
    {
      what: 'a plaque with an inscription',
      options: {
        hasArticle: false,
        storyMissing: true,
        retoldStatus: 'none',
        retold: null,
        relics: [],
        name: 'Jimi Hendrix',
        record: hendrixPlaque,
      },
    },
    {
      what: 'a listed building with a grade and nothing to read',
      options: {
        hasArticle: false,
        storyMissing: true,
        retoldStatus: 'none',
        retold: null,
        relics: [],
        name: 'Telephone Kiosks, Broad Court',
        record: kiosks,
      },
    },
    {
      what: 'a bare pin with nothing under it',
      options: {
        hasArticle: false,
        storyMissing: true,
        retoldStatus: 'none',
        retold: null,
        relics: [],
        name: 'Bow Street',
        record: bowStreet,
      },
    },
    {
      what: 'an area with relics and no article',
      options: {
        hasArticle: false,
        storyMissing: true,
        retoldStatus: 'none',
        retold: null,
        relics: [relic(1, 'Theatre Royal, Covent Garden')],
        name: 'Covent Garden',
      },
    },
    {
      what: 'an area with neither article nor relics',
      options: {
        hasArticle: false,
        storyMissing: true,
        retoldStatus: 'none',
        retold: null,
        relics: [],
        name: 'Cudham',
      },
    },
    {
      what: 'a nameless spot mid-sea',
      options: {
        hasArticle: false,
        retoldStatus: 'none',
        retold: null,
        relics: [],
        name: null,
      },
    },
  ];

  test.each(shapes)('$what', ({ options }) => {
    const rows = buildGazetteerRows(options);
    const verdict = emptyVerdict('none', options.hasArticle);
    // Rows, or the copy — one or the other, always one of them
    expect(rows.length > 0 || verdict === 'default').toBe(true);
    if (rows.length === 0) {
      expect(emptyGazetteerCopy(options.name)).toMatch(/^Nothing is written down within a walk/);
    }
  });
});

describe('partRowIndex (a tapped year finds its part)', () => {
  test('maps the timeline anchor to its row', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      relics: [],
    });
    // timeline, part0 → part 2 (1-based) sits at row 2, one earlier than
    // before: the ai-label byline moved out from the top of the screen
    expect(partRowIndex(rows, 2)).toBe(2);
    expect(rows[partRowIndex(rows, 2)]).toMatchObject({ kind: 'part', index: 1 });
    expect(partRowIndex(rows, 99)).toBe(-1);
  });
});
