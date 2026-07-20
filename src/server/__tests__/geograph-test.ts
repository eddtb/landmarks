import { diskBackedMap } from '@/server/ai-cache';
import {
  buildPhotos,
  dressWithPhotos,
  fullSizeUrl,
  GeographPhoto,
  pickPhotoFor,
} from '@/server/geograph';
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

beforeEach(() => {
  diskBackedMap('story-photos').clear(); // the disk cache outlives runs BY DESIGN
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

describe('pickPhotoFor', () => {
  const photos = buildPhotos(syndicatorItems);

  test('nearest within range wins; out of range is null', () => {
    expect(pickPhotoFor(story({}), photos)?.credit).toContain('Alan Swain');
    const far = story({ coordinates: { latitude: 51.6, longitude: -0.0015 } });
    expect(pickPhotoFor(far, photos)).toBeNull();
  });
});

describe('dressWithPhotos', () => {
  const photos = buildPhotos(syndicatorItems);
  const noCommons = async () => null;

  test('Commons wins when it has a title-matched photo; Geograph never asked', async () => {
    const geograph = jest.fn(async () => photos);
    const commons = jest.fn(async () => ({ imageUrl: 'https://up/plaque.jpg', credit: 'Photo: Endim8 / Commons (CC BY 4.0)' }));
    const [dressed] = await dressWithPhotos([story({ pageId: 50 })], geograph, commons);
    expect(dressed.thumbnailUrl).toBe('https://up/plaque.jpg');
    expect(dressed.thumbnailCredit).toContain('Commons');
    expect(geograph).not.toHaveBeenCalled();
  });

  test('the response never waits past the deadline; the lookup still lands in the cache', async () => {
    const slow = jest.fn(
      () => new Promise<typeof photos>((resolve) => setTimeout(() => resolve(photos), 40))
    );
    const [bare] = await dressWithPhotos([story({ pageId: 60 })], slow, noCommons, 5);
    expect(bare.thumbnailUrl).toBeUndefined(); // deadline won the race

    await new Promise((resolve) => setTimeout(resolve, 60)); // background lookup completes
    const [dressed] = await dressWithPhotos([story({ pageId: 60 })], slow, noCommons, 5);
    expect(dressed.thumbnailUrl).toContain('936190_fc8d5315.jpg'); // served from cache
    expect(slow).toHaveBeenCalledTimes(1);
  });

  test('a Commons failure falls through to Geograph, not to bare', async () => {
    const geograph = jest.fn(async () => photos);
    const commons = jest.fn(async () => { throw new Error('down'); });
    const [dressed] = await dressWithPhotos([story({ pageId: 51 })], geograph, commons);
    expect(dressed.thumbnailUrl).toContain('936190_fc8d5315.jpg');
  });

  test('queries near each bare STORY, keeps existing photos, caches per story', async () => {
    const fetcher = jest.fn(async () => photos);
    const items = [
      story({ pageId: 1, thumbnailUrl: 'https://wiki/own.jpg' }),
      story({ pageId: 2 }),
    ];

    const dressed = await dressWithPhotos(items, fetcher, noCommons);
    expect(fetcher).toHaveBeenCalledTimes(1); // only the bare story
    expect(fetcher).toHaveBeenCalledWith(items[1].coordinates);
    expect(dressed[0].thumbnailUrl).toBe('https://wiki/own.jpg');
    expect(dressed[0].thumbnailCredit).toBeUndefined();
    expect(dressed[1].thumbnailUrl).toContain('936190_fc8d5315.jpg');
    expect(dressed[1].thumbnailCredit).toContain('Geograph');

    await dressWithPhotos(items, fetcher, noCommons);
    expect(fetcher).toHaveBeenCalledTimes(1); // second request: all from cache
  });

  test('no photo nearby is cached too; failures are not', async () => {
    const noPhotos = jest.fn(async () => [] as GeographPhoto[]);
    await dressWithPhotos([story({ pageId: 3 })], noPhotos, noCommons);
    await dressWithPhotos([story({ pageId: 3 })], noPhotos, noCommons);
    expect(noPhotos).toHaveBeenCalledTimes(1); // null result cached

    const failing = jest.fn(async () => {
      throw new Error('down');
    });
    const [bare] = await dressWithPhotos([story({ pageId: 4 })], failing, noCommons);
    expect(bare.thumbnailUrl).toBeUndefined();
    await dressWithPhotos([story({ pageId: 4 })], failing, noCommons);
    expect(failing).toHaveBeenCalledTimes(2); // failure retried
  });

  test('caps uncached lookups per request', async () => {
    const fetcher = jest.fn(async () => [] as GeographPhoto[]);
    const many = Array.from({ length: 20 }, (_, index) => story({ pageId: 100 + index }));
    await dressWithPhotos(many, fetcher, noCommons);
    expect(fetcher).toHaveBeenCalledTimes(15);
  });
});
