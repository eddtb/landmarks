import { diskBackedMap } from '@/server/ai-cache';
import { enrichStandaloneListed } from '@/server/heritage';
import { HistoryItem } from '@/types/history';

jest.mock('@/server/wikipedia', () => ({
  findStory: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findStory } = require('@/server/wikipedia') as { findStory: jest.Mock };

const registerCard: HistoryItem = {
  pageId: 2_001_079_013,
  title: 'Cutty Sark',
  coordinates: { latitude: 51.48285, longitude: -0.00958 },
  distanceMeters: 700,
  extract: 'Grade I listed building on the National Heritage List for England.',
  url: 'https://historicengland.org.uk/listing/the-list/list-entry/1079013',
  source: 'Historic England · Grade I',
};

beforeEach(() => {
  diskBackedMap('nhle-stories').clear(); // the disk cache outlives runs BY DESIGN
  findStory.mockReset();
});

describe('enrichStandaloneListed', () => {
  test('a standalone register card gets its own article, looked up at the BUILDING', async () => {
    findStory.mockResolvedValue({
      story: 'Cutty Sark is a British clipper ship.',
      title: 'Cutty Sark',
      url: 'https://en.wikipedia.org/wiki/Cutty_Sark',
      thumbnailUrl: 'https://upload.wikimedia.org/cutty.jpg',
    });

    const [enriched] = await enrichStandaloneListed([registerCard]);

    expect(findStory).toHaveBeenCalledWith('Cutty Sark', registerCard.coordinates);
    expect(enriched).toMatchObject({
      extract: 'Cutty Sark is a British clipper ship.',
      url: 'https://en.wikipedia.org/wiki/Cutty_Sark',
      thumbnailUrl: 'https://upload.wikimedia.org/cutty.jpg',
      source: 'Wikipedia · Grade I listed', // same badge as a direct merge
    });
  });

  test('caches per list entry: the second request asks Wikipedia nothing', async () => {
    findStory.mockResolvedValue({ story: 'S', title: 'T', url: 'https://u' });
    await enrichStandaloneListed([registerCard]);
    await enrichStandaloneListed([registerCard]);
    expect(findStory).toHaveBeenCalledTimes(1);
  });

  test('no matching article, non-register cards, and lookup failures pass through', async () => {
    findStory.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));
    const wiki = { ...registerCard, pageId: 5, source: 'Wikipedia' };

    const first = await enrichStandaloneListed([registerCard, wiki]);
    expect(first[0].source).toBe('Historic England · Grade I'); // null match cached, card kept
    expect(first[1]).toBe(wiki); // not a register card — untouched, no lookup

    diskBackedMap('nhle-stories').clear();
    const [afterFailure] = await enrichStandaloneListed([registerCard]);
    expect(afterFailure.source).toBe('Historic England · Grade I'); // failure ≠ cached
    expect(findStory).toHaveBeenCalledTimes(2);
  });
});
