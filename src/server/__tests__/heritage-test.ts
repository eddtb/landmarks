import {
  buildListedBuildingItems,
  buildPlaqueItems,
  mergeHistorySources,
  plaqueSubjectName,
  plaqueTitle,
  titleCaseName,
} from '@/server/heritage';
import { story } from '@/test-utils/story';

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

  test('collapses the inscription and files the plaque under its subject', () => {
    expect(items).toHaveLength(1);
    // The dedication, not the first sixty characters of a biography.
    // "In September 1767" is a preamble, so the name is taken from the
    // clause after it — and the whole inscription survives as the extract.
    expect(items[0].title).toBe('Olaudah Equiano');
    expect(items[0].extract).not.toMatch(/[\r\n]/);
    expect(items[0].extract).toContain('African writer and abolitionist');
    expect(items[0].pageId).toBe(3_000_059_267);
    expect(items[0].source).toBe('Open Plaques');
  });

  /**
   * Every inscription below was read off the live Open Plaques box query
   * on 2026-08-10 — the same call the feed makes, which answers with id,
   * coordinates and inscription and nothing else. The subject, the
   * address and the plaque's own title live one HTTP call per plaque
   * away, so the name is read out of the inscription or not claimed.
   */
  describe('plaqueSubjectName (the dedication, or nothing)', () => {
    test('capitalised words closed by a lifespan are the subject', () => {
      expect(plaqueSubjectName('Jimi Hendrix 1942-1970 guitarist and songwriter lived here 1968-1969')).toBe(
        'Jimi Hendrix'
      );
      expect(plaqueSubjectName('Sir John Betjeman 1906-1984 Poet Laureate and writer lived here')).toBe(
        'Sir John Betjeman'
      );
      expect(plaqueSubjectName('Horatio, Lord Nelson 1758-1805 lived here in 1798')).toBe(
        'Horatio, Lord Nelson'
      );
      // An en-dashed span, a d. and a c. are all lifespans
      expect(plaqueSubjectName('Christina Broom 1862–1939 Photographer lived and worked here')).toBe(
        'Christina Broom'
      );
      expect(plaqueSubjectName('WINIFRED ATWELL d.1983 Pianist, entertainer and entrepreneur lived here')).toBe(
        'Winifred Atwell'
      );
    });

    test('a plaque that shouts is quieted; initials keep their own case', () => {
      expect(plaqueSubjectName('AUDREY HEPBURN 1929–1993 Actress lived in a flat at number 65')).toBe(
        'Audrey Hepburn'
      );
      expect(plaqueSubjectName('J.L. Garvin C.H. 1868 - 1947 for thirty-four years Editor of The Observer')).toBe(
        'J.L. Garvin C.H.'
      );
    });

    test('anything less certain than that is not claimed', () => {
      // Prose before any lifespan: the subject is buried mid-sentence
      expect(
        plaqueSubjectName('This tunnel constructed by the London County Council was opened in 1902')
      ).toBeNull();
      expect(plaqueSubjectName('Radio History On this site stood Communications House')).toBeNull();
      expect(plaqueSubjectName('Battersea Park The site of this park was formerly known as Battersea Fields')).toBeNull();
      // Opens with a number: an occasion, not a person
      expect(plaqueSubjectName('400 Year Celebration 1625 - 2025 St. Oliver Plunkett.')).toBeNull();
      // A service number is not a lifespan — this man is not "Detective Constable"
      expect(plaqueSubjectName('Detective Constable 0144 John Raymond Coker. Passed away 1985')).toBeNull();
      // Longer than any name: a sentence in capitals
      expect(
        plaqueSubjectName('Turner House Artists Alfred Turner RA (1873 - 1940) and his daughter')
      ).toBeNull();
    });

    test('an unclaimed name leaves the old truncation exactly as it was', () => {
      expect(plaqueTitle('Peter the Great planted a mulberry here')).toBe(
        'Peter the Great planted a mulberry here'
      );
      expect(
        plaqueTitle('This gateway marks the position of the north bank of the River Thames before the Embankment')
      ).toBe('This gateway marks the position of the north bank of the…');
    });
  });
});

describe('mergeHistorySources', () => {
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
