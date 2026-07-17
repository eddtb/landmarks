import { buildHistoryItems, isStoryTitle } from '@/server/wikipedia';

const Center = { latitude: 51.5055, longitude: -0.0906 };

const entries = [
  { pageid: 1, title: 'Borough Compter', lat: 51.5045, lon: -0.0905 },
  { pageid: 2, title: 'Liberty of the Clink', lat: 51.5068, lon: -0.0925 },
  { pageid: 3, title: 'No Batch Data', lat: 51.5056, lon: -0.0907 },
];

const pages = {
  '1': {
    pageid: 1,
    title: 'Borough Compter',
    extract: 'A small prison in Southwark...',
    thumbnail: { source: 'https://upload.wikimedia.org/compter.jpg' },
    fullurl: 'https://en.wikipedia.org/wiki/Borough_Compter',
  },
  '2': {
    pageid: 2,
    title: 'Liberty of the Clink',
    extract: 'An area outside the City jurisdiction...',
    fullurl: 'https://en.wikipedia.org/wiki/Liberty_of_the_Clink',
  },
};

describe('buildHistoryItems', () => {
  test('joins geosearch entries with batch data and sorts by distance', () => {
    const items = buildHistoryItems(entries, pages, Center);

    // pageid 3 is nearest, then 1, then 2
    expect(items.map((item) => item.pageId)).toEqual([3, 1, 2]);
    expect(items[1]).toMatchObject({
      title: 'Borough Compter',
      extract: 'A small prison in Southwark...',
      thumbnailUrl: 'https://upload.wikimedia.org/compter.jpg',
      url: 'https://en.wikipedia.org/wiki/Borough_Compter',
    });
  });

  test('tolerates entries missing from the batch response', () => {
    const items = buildHistoryItems(entries, pages, Center);
    const bare = items.find((item) => item.pageId === 3);

    expect(bare?.title).toBe('No Batch Data');
    expect(bare?.extract).toBeUndefined();
    expect(bare?.thumbnailUrl).toBeUndefined();
    expect(bare?.url).toContain('curid=3'); // fallback URL still works
  });

  test('items without thumbnails omit the field rather than failing', () => {
    const items = buildHistoryItems(entries, pages, Center);
    const clink = items.find((item) => item.pageId === 2);
    expect(clink?.thumbnailUrl).toBeUndefined();
    expect(clink?.extract).toContain('City jurisdiction');
  });
});

describe('isStoryTitle (register gate)', () => {
  // The exact noise measured near Greenwich, 2026-07-17
  test('gates stations, plain streets, and piers', () => {
    expect(isStoryTitle('Cutty Sark for Maritime Greenwich DLR station')).toBe(false);
    expect(isStoryTitle('Greenwich Church Street')).toBe(false);
    expect(isStoryTitle('King William Walk')).toBe(false);
    expect(isStoryTitle('Greenwich Pier')).toBe(false);
  });

  test('keeps the treasure', () => {
    expect(isStoryTitle('Palace of Placentia')).toBe(true);
    expect(isStoryTitle('JASON reactor')).toBe(true);
    expect(isStoryTitle('Greenwich foot tunnel')).toBe(true);
    expect(isStoryTitle('Statue of Sir Walter Raleigh')).toBe(true);
    expect(isStoryTitle('Prince Frederick\'s Barge')).toBe(true);
    // "Walk"/"Street" only gate as the final word of a plain street name
    expect(isStoryTitle('Walbrook Street Massacre')).toBe(true);
  });
});
