import { assignPhotos, buildPhotos, fullSizeUrl } from '@/server/geograph';
import { HistoryItem } from '@/types/history';

// Recorded from the live syndicator response, 2026-07-20
const syndicatorItems = [
  {
    title: 'TQ3877 : Greenwich Observatory- Meridian Line',
    author: 'Alan Swain',
    guid: '936190',
    lat: 51.47788928497939,
    long: -0.0015418294266970453,
    thumb: 'https://s2.geograph.org.uk/photos/93/61/936190_fc8d5315_120x120.jpg',
  },
  { title: 'No position', thumb: 'https://s2.geograph.org.uk/x_120x120.jpg' }, // dropped
];

const story = (overrides: Partial<HistoryItem>): HistoryItem => ({
  pageId: 1,
  title: 'Royal Observatory',
  coordinates: { latitude: 51.4779, longitude: -0.0015 },
  distanceMeters: 10,
  url: 'https://example.org',
  source: 'Wikipedia',
  ...overrides,
});

describe('buildPhotos', () => {
  test('full-size URL is the thumb without its dimensions suffix (verified live: 200)', () => {
    const photos = buildPhotos(syndicatorItems);
    expect(photos).toHaveLength(1);
    expect(photos[0].imageUrl).toBe('https://s2.geograph.org.uk/photos/93/61/936190_fc8d5315.jpg');
    expect(photos[0].credit).toBe('Photo: Alan Swain / Geograph (CC BY-SA)');
  });

  test('fullSizeUrl leaves suffix-free URLs alone', () => {
    expect(fullSizeUrl('https://x/y.jpg')).toBe('https://x/y.jpg');
  });
});

describe('assignPhotos', () => {
  const photos = buildPhotos(syndicatorItems);

  test('dresses the unillustrated story nearby, with attribution', () => {
    const [dressed] = assignPhotos([story({})], photos);
    expect(dressed.thumbnailUrl).toContain('936190_fc8d5315.jpg');
    expect(dressed.thumbnailCredit).toContain('Alan Swain');
  });

  test('never replaces an existing photo, never reuses one, respects range', () => {
    const items = [
      story({ pageId: 1, thumbnailUrl: 'https://wiki/own.jpg' }),
      story({ pageId: 2 }),
      story({ pageId: 3 }), // photo already taken by pageId 2
      story({ pageId: 4, coordinates: { latitude: 51.6, longitude: -0.0015 } }), // ~13km away
    ];
    const dressed = assignPhotos(items, photos);
    expect(dressed[0].thumbnailUrl).toBe('https://wiki/own.jpg');
    expect(dressed[0].thumbnailCredit).toBeUndefined();
    expect(dressed[1].thumbnailCredit).toContain('Geograph');
    expect(dressed[2].thumbnailUrl).toBeUndefined();
    expect(dressed[3].thumbnailUrl).toBeUndefined();
  });
});
