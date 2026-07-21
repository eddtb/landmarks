import { gazetteerRows } from '@/components/area-gazetteer';
import { HistoryItem } from '@/types/history';

const relic = (pageId: number, title: string, extract: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract,
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
});

describe('gazetteerRows', () => {
  test('groups vanished first, with honest counts in the section heads', () => {
    const rows = gazetteerRows([
      relic(1, 'JASON reactor', 'JASON was a low-power nuclear research reactor.'),
      relic(2, 'Palace of Placentia', 'The Palace of Placentia was an English royal residence.'),
      relic(3, 'Turkish gun', 'This gun sits on the riverfront.'),
    ]);

    expect(rows.map((row) => (row.kind === 'section' ? row.title : row.item.title))).toEqual([
      'No longer standing · 2',
      'JASON reactor',
      'Palace of Placentia',
      'Hidden history · 1',
      'Turkish gun',
    ]);
  });

  test('empty groups get no section head', () => {
    const rows = gazetteerRows([relic(3, 'Turkish gun', 'This gun sits on the riverfront.')]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'section', title: 'Hidden history · 1' });
  });
});
