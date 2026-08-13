/**
 * The plaque-subject gate, held to the same standard as the photo
 * rule: a wrong pairing is worse than none. Fixtures are tonight's
 * real Greenwich plaques.
 */
import { HistoryItem } from '@/types/history';

const plaque = (pageId: number, extract: string): HistoryItem => ({
  pageId,
  title: extract.slice(0, 40),
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract,
  url: `https://openplaques.org/plaques/${pageId}`,
  source: 'Open Plaques',
});

function load(findStoryImpl: jest.Mock) {
  jest.resetModules();
  jest.doMock('@/server/wikipedia', () => ({ findStory: findStoryImpl }));
  jest.doMock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/server/plaque-subject') as typeof import('@/server/plaque-subject');
}

describe('resolvePlaqueSubjects', () => {
  const creek = plaque(31040, 'Deptford Creek. This is the mouth of the River Ravensbourne.');

  test('a confident match retitles the plaque and lends its photo', async () => {
    const findStory = jest.fn(async () => ({
      story: '…',
      title: 'River Ravensbourne',
      url: 'https://en.wikipedia.org/wiki/River_Ravensbourne',
      thumbnailUrl: 'https://img/ravensbourne.jpg',
    }));
    const { resolvePlaqueSubjects } = load(findStory);
    const [resolved] = await resolvePlaqueSubjects([creek], []);
    expect(resolved.title).toBe('River Ravensbourne');
    expect(resolved.thumbnailUrl).toBe('https://img/ravensbourne.jpg');
    expect(resolved.extract).toContain('Deptford Creek'); // the inscription survives
  });

  test('no confident subject: the inscription stands, untouched', async () => {
    const gun = plaque(11718, 'This Turkish bronze gun was cast in 1790-91 (AH 1212).');
    const findStory = jest.fn(async () => null);
    const { resolvePlaqueSubjects } = load(findStory);
    const [resolved] = await resolvePlaqueSubjects([gun], []);
    expect(resolved).toEqual(gun);
  });

  test('a subject the feed already tells is not duplicated — but the story screen may still open it', async () => {
    const findStory = jest.fn(async () => ({
      story: '…',
      title: 'River Ravensbourne',
      url: 'https://en.wikipedia.org/wiki/River_Ravensbourne',
    }));
    const backbone = [plaque(1, 'x'), { ...plaque(2, 'y'), title: 'River Ravensbourne', source: 'Wikipedia' }];
    const { resolvePlaqueSubjects } = load(findStory);
    const [resolved] = await resolvePlaqueSubjects([creek], backbone);
    expect(resolved.title).toBe(creek.title); // the card stays an inscription
    expect(resolved.subject).toBe('River Ravensbourne'); // the screen opens the story
  });

  test('one search per plaque per month: the second pass hits the cache', async () => {
    const findStory = jest.fn(async () => null);
    const { resolvePlaqueSubjects } = load(findStory);
    await resolvePlaqueSubjects([creek], []);
    await resolvePlaqueSubjects([creek], []);
    expect(findStory).toHaveBeenCalledTimes(1);
  });

  test('an upstream failure degrades to the inscription and is not cached', async () => {
    const findStory = jest.fn(async () => {
      throw new Error('Wikipedia 429');
    });
    const { resolvePlaqueSubjects } = load(findStory);
    const [resolved] = await resolvePlaqueSubjects([creek], []);
    expect(resolved).toEqual(creek);
    await resolvePlaqueSubjects([creek], []);
    expect(findStory).toHaveBeenCalledTimes(2); // may try again
  });
});

describe('the plaque pool (cold-feed latency vs politeness)', () => {
  /**
   * One-at-a-time made this the costliest leg of a cold compose
   * (5.4-6.4s of 17s, measured on the deployed worker), and a cold
   * compose is what nearly every reader of a small app gets. Twenty
   * at once is what got the summary endpoint rate-limited in the
   * first place. Both bounds are pinned here so neither lesson can be
   * lost to the other.
   */
  test('resolves concurrently, but never more than three at a time', async () => {
    let live = 0;
    let peak = 0;
    const findStory = jest.fn(async () => {
      live += 1;
      peak = Math.max(peak, live);
      await new Promise((resolve) => setTimeout(resolve, 5));
      live -= 1;
      return null;
    });
    const { resolvePlaqueSubjects } = load(findStory);

    const plaques = Array.from({ length: 15 }, (_, i) => ({
      pageId: 3_000_000_000 + i,
      title: `Plaque ${i}`,
      extract: `Inscription ${i}`,
      coordinates: { latitude: 51.48, longitude: -0.01 },
      distanceMeters: 50,
      url: `https://openplaques.org/plaques/${i}`,
      source: 'Open Plaques',
    }));

    const out = await resolvePlaqueSubjects(plaques, []);

    expect(out).toHaveLength(15); // every plaque still answered
    expect(peak).toBeGreaterThan(1); // …concurrently
    expect(peak).toBeLessThanOrEqual(3); // …but politely
  });

  test('order is preserved — the feed is distance-sorted', async () => {
    const findStory = jest.fn(async () => null);
    const { resolvePlaqueSubjects } = load(findStory);
    const plaques = Array.from({ length: 6 }, (_, i) => ({
      pageId: 3_100_000_000 + i,
      title: `Plaque ${i}`,
      extract: `Inscription ${i}`,
      coordinates: { latitude: 51.48, longitude: -0.01 },
      distanceMeters: 10 * i,
      url: `https://openplaques.org/plaques/x${i}`,
      source: 'Open Plaques',
    }));

    const out = await resolvePlaqueSubjects(plaques, []);
    expect(out.map((p) => p.pageId)).toEqual(plaques.map((p) => p.pageId));
  });
});
