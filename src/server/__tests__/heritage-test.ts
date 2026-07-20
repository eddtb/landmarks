import {
  buildListedBuildingItems,
  buildPlaqueItems,
  mergeHistorySources,
  plaqueTitle,
  titleCaseName,
} from '@/server/heritage';
import { HistoryItem } from '@/types/history';

const Center = { latitude: 51.4779, longitude: -0.0015 };

// Recorded from the live NHLE FeatureServer, 2026-07-20 — geometry is
// MULTIPOINT ([lng, lat] pairs), the shape that broke the first probe
const nhleFeatures = [
  {
    attributes: {
      Name: 'ALTAZIMUTH PAVILION AT THE ROYAL OBSERVATORY',
      Grade: 'II',
      ListEntry: 1031860,
    },
    geometry: { points: [[-0.00087356315409775, 51.477333789744]] as [number, number][] },
  },
  {
    attributes: { Name: 'WAR MEMORIAL AND ATTACHED RAILINGS AND PIERS', Grade: 'II' },
    geometry: { points: [[0.0097, 51.4752]] as [number, number][] },
  }, // no ListEntry → dropped
];

// Recorded from the live Open Plaques box query, 2026-07-20
const plaques = [
  {
    id: 59267,
    latitude: 51.48063,
    longitude: 0.00373,
    inscription:
      'In September 1767\r\nOlaudah Equiano\r\nc.1745-1797\r\nAfrican writer and abolitionist,\r\nspent time in this house',
  },
  { id: 1, inscription: 'No coordinates' }, // dropped
];

describe('titleCaseName', () => {
  test('brings NHLE names down from all caps, sparing small words', () => {
    expect(titleCaseName('ALTAZIMUTH PAVILION AT THE ROYAL OBSERVATORY')).toBe(
      'Altazimuth Pavilion at the Royal Observatory'
    );
    expect(titleCaseName('CHURCH OF ST ALFEGE')).toBe('Church of St Alfege');
  });
});

describe('buildListedBuildingItems', () => {
  const items = buildListedBuildingItems(nhleFeatures, Center);

  test('parses the multipoint geometry the first probe misread', () => {
    expect(items).toHaveLength(1);
    expect(items[0].coordinates.latitude).toBeCloseTo(51.4773, 3);
    expect(items[0].coordinates.longitude).toBeCloseTo(-0.0009, 3);
  });

  test('carries grade, list-entry url, and a namespaced pageId', () => {
    expect(items[0]).toMatchObject({
      pageId: 2_001_031_860,
      title: 'Altazimuth Pavilion at the Royal Observatory',
      source: 'Historic England · Grade II',
      url: 'https://historicengland.org.uk/listing/the-list/list-entry/1031860',
    });
  });
});

describe('buildPlaqueItems', () => {
  const items = buildPlaqueItems(plaques, Center);

  test('collapses the inscription and cuts a readable title', () => {
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('In September 1767 Olaudah Equiano c.1745-1797 African…');
    expect(items[0].extract).not.toMatch(/[\r\n]/);
    expect(items[0].pageId).toBe(3_000_059_267);
    expect(items[0].source).toBe('Open Plaques');
  });

  test('plaqueTitle keeps short inscriptions whole', () => {
    expect(plaqueTitle('Peter the Great planted a mulberry here')).toBe(
      'Peter the Great planted a mulberry here'
    );
  });
});

describe('mergeHistorySources', () => {
  const story = (overrides: Partial<HistoryItem>): HistoryItem => ({
    pageId: 1,
    title: 'Royal Observatory',
    coordinates: { latitude: 51.4778, longitude: -0.0014 },
    distanceMeters: 10,
    url: 'https://en.wikipedia.org/wiki/Royal_Observatory',
    source: 'Wikipedia',
    ...overrides,
  });

  test('many register records at one place become ONE badge — the best grade', () => {
    const listed = buildListedBuildingItems(
      [
        {
          attributes: { Name: 'ROYAL OBSERVATORY', Grade: 'II', ListEntry: 98 },
          geometry: { points: [[-0.0015, 51.4779]] as [number, number][] },
        },
        {
          attributes: { Name: 'ROYAL OBSERVATORY', Grade: 'I', ListEntry: 99 },
          geometry: { points: [[-0.0015, 51.4779]] as [number, number][] },
        },
        {
          attributes: { Name: 'ROYAL OBSERVATORY GATES', Grade: 'II', ListEntry: 100 },
          geometry: { points: [[-0.0015, 51.4779]] as [number, number][] },
        },
      ],
      Center
    );
    const merged = mergeHistorySources([story({})], listed, []);

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('Wikipedia · Grade I listed');
  });

  test('a distant or unrelated NOTABLE record stands as its own story', () => {
    const listed = buildListedBuildingItems(
      [
        {
          attributes: { Name: 'SAXONIA WIRE COMPANY OFFICE', Grade: 'II*', ListEntry: 7 },
          geometry: { points: [[-0.0117, 51.4803]] as [number, number][] },
        },
      ],
      Center
    );
    const merged = mergeHistorySources([story({})], listed, buildPlaqueItems(plaques, Center));

    expect(merged.map((item) => item.source)).toEqual(
      expect.arrayContaining(['Wikipedia', 'Historic England · Grade II*', 'Open Plaques'])
    );
    expect(merged).toHaveLength(3);
  });

  test('a plaque within 30m merges into the story whatever its wording', () => {
    const tunnel = story({
      pageId: 9,
      title: 'Greenwich foot tunnel',
      coordinates: { latitude: 51.4779, longitude: -0.0015 },
    });
    const plaqueOnIt = buildPlaqueItems(
      [
        {
          id: 77,
          latitude: 51.4779,
          longitude: -0.0015,
          inscription: 'This tunnel constructed by the London County Council was opened in 1902',
        },
      ],
      Center
    );
    const merged = mergeHistorySources([tunnel], [], plaqueOnIt);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('Wikipedia · plaque');
  });

  test('an unmatched Grade II record enriches nothing and earns no card', () => {
    const listed = buildListedBuildingItems(
      [
        {
          attributes: { Name: '37 AND 37A KING WILLIAM WALK', Grade: 'II', ListEntry: 8 },
          geometry: { points: [[-0.0117, 51.4803]] as [number, number][] },
        },
      ],
      Center
    );
    const merged = mergeHistorySources([story({})], listed, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('Wikipedia');
  });

  test('sorts everything by distance and never mutates the inputs', () => {
    const wiki = [story({ distanceMeters: 500 })];
    const merged = mergeHistorySources(
      wiki,
      [story({ pageId: 2, title: 'Nearer Thing', distanceMeters: 5, source: 'Historic England · Grade I' })],
      []
    );
    expect(merged[0].title).toBe('Nearer Thing');
    expect(wiki[0].source).toBe('Wikipedia'); // input untouched
  });
});
