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

  test('several register records resolving to one article yield one card, nearest first', async () => {
    findStory.mockResolvedValue({
      story: 'The National Maritime Museum is a maritime museum in Greenwich.',
      title: 'National Maritime Museum',
      url: 'https://en.wikipedia.org/wiki/National_Maritime_Museum',
    });
    const west = { ...registerCard, pageId: 2_000_000_001, distanceMeters: 200 };
    const east = { ...registerCard, pageId: 2_000_000_002, distanceMeters: 350 };

    const result = await enrichStandaloneListed([west, east]);
    expect(result).toHaveLength(1);
    expect(result[0].distanceMeters).toBe(200);
  });

  test('story or no card: articleless register entries and failures are dropped', async () => {
    findStory.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));
    const wiki = { ...registerCard, pageId: 5, source: 'Wikipedia' };

    const first = await enrichStandaloneListed([registerCard, wiki]);
    expect(first).toEqual([wiki]); // no article → no card; wiki card untouched

    diskBackedMap('nhle-stories').clear();
    const afterFailure = await enrichStandaloneListed([registerCard]);
    expect(afterFailure).toEqual([]); // dropped, but failure ≠ cached…
    expect(findStory).toHaveBeenCalledTimes(2); // …so the lookup retried
  });
});

describe('the politeness fence (regression: production 502s, 27 July)', () => {
  /**
   * A dense listed-building area brings dozens of register cards, and
   * each uncached enrichment is up to two Wikipedia calls. Fanning
   * those out at once got the worker's egress IP rate-limited, so the
   * NEXT reader's feed came back 502 and the app said "you're
   * offline". The fence is the invariant worth pinning — not the
   * incident, and not the exact number.
   */
  test('a dense area never opens more than a handful of lookups at once', async () => {
    let live = 0;
    let peak = 0;
    findStory.mockImplementation(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return { story: 'A story.', title: 'T', url: 'https://en.wikipedia.org/wiki/T' };
    });

    const dense = Array.from({ length: 30 }, (_, i) => ({
      ...registerCard,
      pageId: 2_001_000_000 + i,
      title: `Listed building ${i}`,
    }));

    await enrichStandaloneListed(dense);

    expect(findStory).toHaveBeenCalledTimes(30); // every card still resolved
    expect(peak).toBeLessThanOrEqual(4); // …but never all at once
  });

  test('cards needing no lookup cost no concurrency at all', async () => {
    findStory.mockResolvedValue(null);
    // Distinct URLs: same-article cards are deduped by design (one
    // card per article, nearest wins), which would mask the pass-through
    const wikiCards = Array.from({ length: 20 }, (_, i) => ({
      ...registerCard,
      pageId: 3000 + i,
      url: `https://en.wikipedia.org/wiki/Story_${i}`,
      source: 'Wikipedia',
    }));

    const out = await enrichStandaloneListed(wikiCards);

    expect(findStory).not.toHaveBeenCalled();
    expect(out).toHaveLength(20); // passed through untouched, order intact
    expect(out[0].pageId).toBe(3000);
    expect(out[19].pageId).toBe(3019);
  });
});
