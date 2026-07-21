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
  test('groups lost first, plaques as their own present section, with honest counts', () => {
    const gunPlaque = {
      ...relic(4, 'This Turkish bronze gun was cast in 1790-91…', 'This Turkish bronze gun was cast in 1790-91 in Istanbul.'),
      source: 'Open Plaques',
    };
    const rows = gazetteerRows([
      relic(1, 'JASON reactor', 'JASON was a low-power nuclear research reactor.'),
      relic(2, 'Palace of Placentia', 'The Palace of Placentia was an English royal residence.'),
      gunPlaque,
      relic(3, 'Statue of George II', 'The statue was unveiled in 1959 and sits in the square.'),
    ]);

    expect(rows.map((row) => (row.kind === 'section' ? row.title : row.item.title))).toEqual([
      'Lost · 2',
      'JASON reactor',
      'Palace of Placentia',
      'Plaques · 1',
      'This Turkish bronze gun was cast in 1790-91…',
      'Hidden history · 1',
      'Statue of George II',
    ]);
  });

  test('empty groups get no section head', () => {
    const rows = gazetteerRows([relic(3, 'Turkish gun', 'This gun sits on the riverfront.')]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ kind: 'section', title: 'Hidden history · 1' });
  });
});
