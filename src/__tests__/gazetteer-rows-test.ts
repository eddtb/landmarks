import { buildGazetteerRows, partRowIndex } from '@/components/area-gazetteer';
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
