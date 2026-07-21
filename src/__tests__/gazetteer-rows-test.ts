import { gazetteerRows } from '@/components/area-gazetteer';
import { HistoryItem } from '@/types/history';

const relic = (pageId: number, title: string, pastTag?: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract: 'Some record.',
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
  pastTag,
});

describe('gazetteerRows', () => {
  test("one neutral list — 'simply a history of the greater area'", () => {
    const rows = gazetteerRows([
      relic(1, 'Palace of Placentia', 'Demolished 1694'),
      relic(2, 'JASON reactor'),
      relic(3, 'Greenwich Castle', 'Until 1675'),
    ]);

    expect(rows.map((row) => (row.kind === 'section' ? row.title : row.item.title))).toEqual([
      'From this ground · 3',
      'Palace of Placentia',
      'JASON reactor',
      'Greenwich Castle',
    ]);
  });

  test('empty ground, empty rows', () => {
    expect(gazetteerRows([])).toEqual([]);
  });
});
