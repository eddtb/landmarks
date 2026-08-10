/**
 * One invariant, held over EVERY route that writes the durable store.
 *
 * The August 2026 review found the same shape four times: a cache
 * hardened in one place and not carried across. #279 capped retold's
 * caller-chosen key; #303 was the quiz keying on an area while
 * believing the caller's stories. The specific defects differ; the
 * class does not, and it is this:
 *
 *   **No two requests may write the SAME durable key with DIFFERENT
 *   values on the strength of content the client supplied.**
 *
 * A route may take content from the client (the telling does — the
 * extract rides in with the request) as long as that content is in the
 * key, so a fabrication can only ever land in its own slot. Or a route
 * may key on a plain identity (an area, a bucket) as long as it fetches
 * its own material, so there is nothing to fabricate. What is forbidden
 * is the middle: a shared key over material a stranger chose.
 *
 * The probe is deliberately blunt. Each route is asked TWICE about the
 * same thing — the same coordinates, the same area, the same pageId —
 * while everything a client could attach is different: the body, the
 * query string, the lot. Then every key both runs wrote is compared. If
 * a route ignores the content, the two runs are identical and it
 * passes. If a route uses the content, its key moved and it passes.
 * Only a route that let the content through into a SHARED slot fails.
 *
 * The model mock echoes its prompt on purpose: it makes the stored
 * value sensitive to anything the client managed to get in front of the
 * model, so this fence catches an injected prompt as well as an
 * injected key.
 */
import { Article } from '@/types/article';
import { HistoryItem } from '@/types/history';

type Handler = (request: Request) => Promise<Response>;
type Write = { kind: string; key: string; value: string };

// ---------------------------------------------------------------- the store
//
// Every mock factory below is a named `mock*` function rather than an
// inline arrow: jest forbids a factory from reaching outside its own
// scope, and an inline `async` one reaches for a Babel helper that is
// exactly that.

const mockWrites: Write[] = [];

function mockStoreGet(): Promise<undefined> {
  // Always a miss: the second run must actually regenerate, or this
  // test would prove nothing but that caches cache.
  return Promise.resolve(undefined);
}

function mockStorePut(kind: string, key: string, value: unknown): Promise<void> {
  mockWrites.push({ kind, key, value: JSON.stringify(value) });
  return Promise.resolve();
}

function mockTellingStore() {
  return {
    ...(jest.requireActual('@/server/telling-store') as object),
    storeGet: mockStoreGet,
    storePut: mockStorePut,
  };
}
jest.mock('@/server/telling-store', () => mockTellingStore());

// ------------------------------------------------------------ the model, echoing

/** Whatever the model is asked, it answers with what it was asked. */
function mockEcho(prompt: string, label: string): string {
  if (label === 'quiz') {
    // A quiz shaped from the prompt's OWN story list, so any story a
    // client smuggled in comes back out in the cached questions.
    const cited = [...prompt.matchAll(/^- pageId (\d+) \u2014 (.*?):/gm)].slice(0, 3);
    return JSON.stringify({
      questions: cited.map(([, pageId, title]) => ({
        kind: 'anchor',
        pageId: Number(pageId),
        question: `What about ${title}?`,
        options: ['One', 'Two', 'Three', 'Four'],
        answerIndex: 0,
        because: `Because of ${title}.`,
      })),
    });
  }
  if (label.startsWith('retold:')) {
    return JSON.stringify({
      brief: ['A line.', 'Another line.'],
      parts: [1, 2, 3].map((n) => ({ heading: `Part ${n}`, body: prompt.slice(0, 400) })),
      timeline: [],
    });
  }
  // The telling, and anything new: the prompt itself is the answer
  return prompt;
}

type Ask = { prompt: string; label: string };

function mockResearch(options: Ask): Promise<string> {
  return Promise.resolve(mockEcho(options.prompt, options.label));
}

async function* mockResearchStream(options: Ask): AsyncGenerator<string, void, void> {
  yield mockEcho(options.prompt, options.label);
}

function mockAiRouter() {
  return { research: mockResearch, researchStream: mockResearchStream };
}
jest.mock('@/server/ai-router', () => mockAiRouter());

// ------------------------------------------------------- the keyless upstreams

const mockNearby: HistoryItem[] = [1, 2, 3, 4, 5].map((pageId) => ({
  pageId,
  title: `Real Place ${pageId}`,
  coordinates: { latitude: 51.4826, longitude: -0.0077 },
  distanceMeters: pageId * 10,
  extract: `The real story of place ${pageId}, which stood here from 1854.`,
  url: `https://en.wikipedia.org/?curid=${pageId}`,
  source: 'Wikipedia',
}));

function mockWikipedia() {
  return {
    findNearbyHistory: () => Promise.resolve(mockNearby),
    geosearchEntries: () =>
      Promise.resolve([{ pageid: 99, title: 'Greenwich', lat: 51.4826, lon: -0.0077, dist: 10 }]),
    isStoryTitle: () => true,
  };
}
jest.mock('@/server/wikipedia', () => mockWikipedia());

function mockWikidata() {
  return {
    fetchExistenceFacts: () => Promise.resolve(new Map([['Greenwich', { area: true }]])),
  };
}
jest.mock('@/server/wikidata', () => mockWikidata());

function mockHeritage() {
  return {
    ...(jest.requireActual('@/server/heritage') as object),
    fetchListedBuildings: () => Promise.resolve([]),
    fetchPlaques: () => Promise.resolve([]),
    enrichStandaloneListed: (items: HistoryItem[]) => Promise.resolve(items),
  };
}
jest.mock('@/server/heritage', () => mockHeritage());

function mockPlaqueSubject() {
  return { resolvePlaqueSubjects: () => Promise.resolve([]) };
}
jest.mock('@/server/plaque-subject', () => mockPlaqueSubject());

function mockGeograph() {
  return { dressWithPhotos: (items: HistoryItem[]) => Promise.resolve(items) };
}
jest.mock('@/server/geograph', () => mockGeograph());

const mockArticleValue: Article = {
  chapters: [{ title: 'History', paragraphs: ['The real article. '.repeat(200)] }],
  minutes: 8,
  images: [],
};

function mockArticle() {
  return { getArticle: () => Promise.resolve(mockArticleValue) };
}
jest.mock('@/server/article', () => mockArticle());

// ------------------------------------------------------------------- the probes

/**
 * Every store-backed route, with its identity pinned and its
 * client-supplied surface named. `identity` is what the request is
 * ABOUT and never varies; everything else is the stranger's to write.
 */
const probes: {
  what: string;
  load: () => { GET?: Handler; POST?: Handler };
  identity: string;
  body: (content: string) => Record<string, unknown>;
}[] = [
  {
    what: 'GET /api/history',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => require('@/app/api/history+api'),
    identity: 'lat=51.4826&lng=-0.0077',
    body: (content) => ({ items: [{ pageId: 1, title: content, extract: content }] }),
  },
  {
    what: 'GET /api/area',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => require('@/app/api/area+api'),
    identity: 'lat=51.4826&lng=-0.0077',
    body: (content) => ({ name: content }),
  },
  {
    what: 'GET /api/quiz',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => require('@/app/api/quiz+api'),
    identity: 'lat=51.4826&lng=-0.0077',
    body: (content) => ({
      area: 'Greenwich',
      stories: [1, 2, 3, 4, 5].map((pageId) => ({
        pageId: 900 + pageId,
        title: `${content} ${pageId}`,
        extract: `${content} is the answer to everything.`,
      })),
    }),
  },
  {
    what: 'GET /api/retold',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => require('@/app/api/retold+api'),
    identity: 'area=Greenwich',
    body: (content) => ({ source: content, extract: content }),
  },
  {
    what: 'POST /api/telling',
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    load: () => require('@/app/api/telling+api'),
    // The pageId is the identity; the text is the client's to write
    identity: '',
    body: (content) => ({
      pageId: 42,
      title: `Story ${content}`,
      extract: `${content} — the source text this telling is written from.`,
    }),
  },
];

/** Everything a stranger can hang off a URL, whatever the route reads. */
function hostileQuery(identity: string, content: string): string {
  const params = new URLSearchParams({
    title: content,
    extract: content,
    text: content,
    name: content,
    source: content,
    stories: JSON.stringify([{ pageId: 901, title: content, extract: content }]),
  });
  if (!identity.includes('area=')) {
    params.set('area', content);
  }
  return params.toString();
}

/**
 * One run of one route, from a clean module registry — otherwise the
 * second run would answer from the first run's in-process cache and
 * this test would assert nothing at all. The disk-backed maps hang off
 * globalThis and survive resetModules, so they go too.
 */
async function writesOf(probe: (typeof probes)[number], content: string): Promise<Write[]> {
  jest.resetModules();
  delete (globalThis as { aiDiskMaps?: unknown }).aiDiskMaps;
  mockWrites.length = 0;

  const route = probe.load();
  const handler = route.POST ?? route.GET;
  expect(handler).toBeDefined();

  await handler!(
    new Request(`http://localhost/api/probe?${probe.identity}&${hostileQuery(probe.identity, content)}`, {
      // A body on every probe, even where the route has no POST: a
      // route that starts reading one is exactly what this fences.
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(probe.body(content)),
    })
  );
  return mockWrites;
}

describe('no durable cache key may be shared across client-supplied content', () => {
  beforeEach(() => {
    delete process.env.GEMINI_API_KEY;
    process.env.AI_PROVIDER = '';
  });

  for (const probe of probes) {
    test(`${probe.what} — two strangers asking about the same thing cannot overwrite each other`, async () => {
      const alpha = await writesOf(probe, 'ALPHACONTENT');
      const omega = await writesOf(probe, 'OMEGACONTENT');

      // The probe is worthless if neither run wrote anything
      expect(alpha.length + omega.length).toBeGreaterThan(0);

      for (const first of alpha) {
        const collision = omega.find(
          (second) => second.kind === first.kind && second.key === first.key
        );
        if (!collision) {
          // The content is IN the key: a fabrication lands in its own
          // slot and nobody else's. That is the telling's bargain.
          continue;
        }
        // Same slot, so the material must have been the server's:
        // identical, whatever the two strangers attached to their asks.
        expect({ key: first.key, value: collision.value }).toEqual({
          key: first.key,
          value: first.value,
        });
      }
    });
  }

  test('the probe can actually see a poisoned slot', async () => {
    // A fence that has never failed is not a fence. This is the shape
    // the loop above is looking for — one key, two values — proved
    // detectable rather than assumed so.
    const poisoned: Write[] = [{ kind: 'quiz', key: 'v5:greenwich', value: '"alpha"' }];
    const later: Write[] = [{ kind: 'quiz', key: 'v5:greenwich', value: '"omega"' }];

    const collision = later.find(
      (second) => second.kind === poisoned[0].kind && second.key === poisoned[0].key
    );

    expect(collision).toBeDefined();
    expect(collision!.value).not.toEqual(poisoned[0].value);
  });
});
