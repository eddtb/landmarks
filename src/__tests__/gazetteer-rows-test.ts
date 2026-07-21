import { buildGazetteerRows, partRowIndex } from '@/components/area-gazetteer';
import { Retold } from '@/data/retold-client';
import { HistoryItem } from '@/types/history';

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
  test('ready: label, timeline, parts, door — then the ground', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      originalOpen: false,
      relics: [relic(1, 'Palace of Placentia')],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'ai-label',
      'timeline',
      'part',
      'part',
      'part',
      'door',
      'section',
      'relic',
    ]);
  });

  test('the door opens onto the original as a row', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      originalOpen: true,
      relics: [],
    });
    expect(rows.map((row) => row.kind)).toEqual([
      'ai-label',
      'timeline',
      'part',
      'part',
      'part',
      'door',
      'original',
    ]);
  });

  test('pending shows the shimmer, not the fallback; failed shows the original article', () => {
    const pending = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'pending',
      retold: null,
      originalOpen: false,
      relics: [],
    });
    expect(pending.map((row) => row.kind)).toEqual(['retelling-pending']);

    const failed = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'none',
      retold: null,
      originalOpen: false,
      relics: [],
    });
    expect(failed.map((row) => row.kind)).toEqual(['fallback-article']);
  });

  test('no article: the relics stand alone, immediately', () => {
    const rows = buildGazetteerRows({
      hasArticle: false,
      retoldStatus: 'pending',
      retold: null,
      originalOpen: false,
      relics: [relic(1, 'Palace of Placentia'), relic(2, 'JASON reactor')],
    });
    expect(rows.map((row) => row.kind)).toEqual(['section', 'relic', 'relic']);
  });
});

describe('partRowIndex (a tapped year finds its part)', () => {
  test('maps the timeline anchor to its row', () => {
    const rows = buildGazetteerRows({
      hasArticle: true,
      retoldStatus: 'ready',
      retold,
      originalOpen: false,
      relics: [],
    });
    // ai-label, timeline, part0 → part 2 (1-based) sits at row 3
    expect(partRowIndex(rows, 2)).toBe(3);
    expect(rows[partRowIndex(rows, 2)]).toMatchObject({ kind: 'part', index: 1 });
    expect(partRowIndex(rows, 99)).toBe(-1);
  });
});
