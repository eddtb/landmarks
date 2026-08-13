/**
 * The area-name resolver, whose whole job is to stop Apple naming the
 * ground. Beside Crystal Palace Park CoreLocation answers "Bromley" —
 * the borough, whose article is a town four miles away — so the name
 * comes from the nearest article Wikidata classes as an AREA instead.
 *
 * The fixtures are the live geosearch order at 51.4226, -0.0685
 * (probed 2026-07-29): the park and its landmarks rank ahead of every
 * settlement, because an area article sits at its representative
 * centre, not at your feet.
 */
import { ExistenceFacts } from '@/server/wikidata';

type Entry = { pageid: number; title: string; lat: number; lon: number };

const entry = (index: number, title: string): Entry => ({
  pageid: 1000 + index,
  title,
  lat: 51.4226,
  lon: -0.0685,
});

/** The real nearest-first ordering beside the park. */
const crystalPalaceOrder = [
  'Crystal Palace Park',
  'Crystal Palace transmitting station',
  'Crystal Palace Bowl',
  'Crystal Palace Dinosaurs',
  'Crystal Palace, London', // 290m — the first AREA
  'Penge', // 768m
  'Anerley', // 884m
].map((title, index) => entry(index, title));

/** Only these titles carry the broad-area verdict. */
function areasAre(...titles: string[]) {
  return jest.fn(async (asked: string[]) => {
    const facts = new Map<string, ExistenceFacts>();
    for (const title of asked) {
      if (titles.includes(title)) {
        facts.set(title, { area: true });
      }
    }
    return facts;
  });
}

function load(geosearchEntries: jest.Mock, fetchExistenceFacts: jest.Mock) {
  jest.resetModules();
  jest.doMock('@/server/wikipedia', () => ({ geosearchEntries }));
  jest.doMock('@/server/wikidata', () => ({ fetchExistenceFacts }));
  jest.doMock('@/server/ai-cache', () => ({ diskBackedMap: () => new Map() }));
  // The store is off in tests, exactly as it is without TURSO_DATABASE_URL
  jest.doMock('@/server/telling-store', () => ({
    storeGet: jest.fn(async () => undefined),
    storePut: jest.fn(async () => {}),
  }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@/server/area') as typeof import('@/server/area');
}

const crystalPalace = { latitude: 51.4226, longitude: -0.0685 };

describe('findNearestArea', () => {
  test('the nearest AREA names the ground, not the nearest article', async () => {
    const geosearch = jest.fn(async () => crystalPalaceOrder);
    const facts = areasAre('Crystal Palace, London', 'Penge', 'Anerley');
    const { findNearestArea } = load(geosearch, facts);

    // Four landmarks rank closer; none of them is a place you are IN
    expect(await findNearestArea(crystalPalace)).toBe('Crystal Palace, London');
  });

  test('nearest-first ordering decides between areas — no distance arithmetic', async () => {
    // Penge and Anerley are areas too; the order alone must pick one
    const geosearch = jest.fn(async () => crystalPalaceOrder);
    const { findNearestArea } = load(geosearch, areasAre('Penge', 'Anerley'));

    expect(await findNearestArea(crystalPalace)).toBe('Penge');
  });

  test('nowhere nearby is an area: null, a real verdict', async () => {
    // Dorking's live answer — 'area of London' does most of
    // AreaClassIds' work, so outside London this abstains
    const geosearch = jest.fn(async () => crystalPalaceOrder);
    const { findNearestArea } = load(geosearch, areasAre(/* none */));

    expect(await findNearestArea(crystalPalace)).toBeNull();
  });

  test('empty ground asks Wikidata nothing', async () => {
    const geosearch = jest.fn(async () => []);
    const facts = areasAre('Crystal Palace, London');
    const { findNearestArea } = load(geosearch, facts);

    expect(await findNearestArea({ latitude: 48.8767, longitude: -12.4149 })).toBeNull();
    expect(facts).not.toHaveBeenCalled();
  });

  test('a verdict is cached per bucket — the second ask costs nothing', async () => {
    const geosearch = jest.fn(async () => crystalPalaceOrder);
    const facts = areasAre('Crystal Palace, London');
    const { findNearestArea } = load(geosearch, facts);

    expect(await findNearestArea(crystalPalace)).toBe('Crystal Palace, London');
    // A step within the same ~111m bucket
    expect(await findNearestArea({ latitude: 51.42262, longitude: -0.06853 })).toBe(
      'Crystal Palace, London'
    );
    expect(geosearch).toHaveBeenCalledTimes(1);
  });

  test('a failure THROWS and caches nothing — couldn’t-ask is not no-area', async () => {
    const geosearch = jest
      .fn<Promise<Entry[]>, unknown[]>()
      .mockRejectedValueOnce(new Error('Wikipedia geosearch failed with status 429'))
      .mockResolvedValue(crystalPalaceOrder);
    const { findNearestArea } = load(geosearch, areasAre('Crystal Palace, London'));

    await expect(findNearestArea(crystalPalace)).rejects.toThrow('429');
    // Nothing was pinned to the bucket: the next ask really asks, and
    // the borough never gets thirty days of the user's header
    expect(await findNearestArea(crystalPalace)).toBe('Crystal Palace, London');
  });

  test('one geosearch for concurrent askers: three screens, one lookup', async () => {
    let release: (entries: Entry[]) => void = () => {};
    const geosearch = jest.fn(
      () => new Promise<Entry[]>((resolve) => (release = resolve))
    );
    const { findNearestArea } = load(geosearch, areasAre('Crystal Palace, London'));

    // The header, the Nearby body and the Gazetteer body all mount
    const asks = Promise.all([
      findNearestArea(crystalPalace),
      findNearestArea(crystalPalace),
      findNearestArea(crystalPalace),
    ]);
    // Let all three reach the geosearch (the store leg is awaited first)
    await new Promise((resolve) => setImmediate(resolve));
    release(crystalPalaceOrder);

    expect(await asks).toEqual([
      'Crystal Palace, London',
      'Crystal Palace, London',
      'Crystal Palace, London',
    ]);
    expect(geosearch).toHaveBeenCalledTimes(1);
  });

  test('classification is bounded: only the nearest 60 titles are asked about', async () => {
    const deep = Array.from({ length: 200 }, (_, index) => entry(index, `Article ${index}`));
    const geosearch = jest.fn(async () => deep);
    const facts = areasAre('Article 90');
    const { findNearestArea } = load(geosearch, facts);

    // 'Article 90' IS an area, but too far down the list to be asked —
    // a bounded depth is a cost decision, and it abstains honestly
    expect(await findNearestArea(crystalPalace)).toBeNull();
    expect(facts.mock.calls[0][0]).toHaveLength(60);
  });
});
