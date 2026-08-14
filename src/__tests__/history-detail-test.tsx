import { act, fireEvent, render, screen } from '@testing-library/react-native';

import HistoryDetailScreen from '@/app/history/[pageId]';
import { fetchArticle } from '@/data/article-client';
import { ApiError } from '@/data/cached-get';
import { cacheHistoryItems, fetchNearbyHistory } from '@/data/history-client';
import { fetchRetold } from '@/data/retold-client';
import { HistoryItem } from '@/types/history';

const mockUseLocalSearchParams = jest.fn();
const mockPush = jest.fn();

/** A place with no article of its own — the server's own answer, and
 * the only one that means it: a 404. */
const noArticle = async (): Promise<never> => {
  throw new ApiError('Article', 404);
};

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    router: { ...actual.router, push: (...args: unknown[]) => mockPush(...args) },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    Stack: { Screen: () => null },
  };
});

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
const mockExpoFetch = jest.requireMock('expo/fetch').fetch as jest.Mock;

jest.mock('@/data/article-client', () => ({
  // A light miss, said the way the server says it: a 404. These clients
  // never resolve null — they throw, and #291 is precisely the bug that
  // came of a caller flattening that throw into "nothing is there".
  fetchArticleLight: jest.fn(async () => {
    throw new (jest.requireActual('@/data/cached-get').ApiError)('Light article', 404);
  }),
  fetchArticle: jest.fn(async () => ({
    minutes: 3,
    images: [],
    chapters: [
      { title: '', paragraphs: ['The intro, the surprising true thing.'] },
      { title: 'Construction', paragraphs: ['Built by the Borough in 1791.', 'Rebuilt twice.'] },
      { title: 'Demolition', paragraphs: ['Torn down for the railway in 1855.'] },
    ],
  })),
}));

// No retelling in these tests: the original article stands as the story
jest.mock('@/data/retold-client', () => ({ fetchRetold: jest.fn(async () => null) }));

// …and the telling that leads it writes instantly
jest.mock('@/data/telling-client', () => ({
  fetchTelling: jest.fn(async () => 'The compter held debtors two centuries before the railway ate it.'),
}));

// The walk time is live GPS now — a fix ~112m from the Compter keeps
// the "Go · 1 min walk" assertions honest
const mockUseLocation = jest.fn(() => ({
  status: 'ready',
  coordinates: { latitude: 51.5055, longitude: -0.0906 },
}));
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

// The scheme is a test seam here because two of DESIGN.md's rules only
// BITE in dark: #FFFFFF on the dark accent is 2.79:1, and the page
// chip's ink has to follow the theme rather than the photograph.
const mockScheme = jest.fn(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockScheme(),
}));

describe('<HistoryDetailScreen />', () => {
  beforeEach(() => {
    mockUseLocation.mockReset();
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.5055, longitude: -0.0906 },
    });
    mockScheme.mockReturnValue('light');
  });

  beforeAll(() => {
    cacheHistoryItems([
      {
        pageId: 42,
        title: 'Borough Compter',
        coordinates: { latitude: 51.5045, longitude: -0.0905 },
        distanceMeters: 112,
        extract: 'A small compter or prison in Southwark, demolished in 1855.',
        thumbnailUrl: 'https://upload.wikimedia.org/compter.jpg',
        url: 'https://en.wikipedia.org/wiki/Borough_Compter',
        source: 'Wikipedia',
      },
    ]);
  });

  test('a place with its own article gets the Gazetteer treatment', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    // The hero leads with the place's own story
    expect(await screen.findByText('The story of')).toBeOnTheScreen();
    expect(screen.getByText('Borough Compter')).toBeOnTheScreen();
    // The hero speaks for the body it actually shows: the telling,
    // about a minute — not the article's minutes and chapter count for
    // chapters the screen no longer renders ("1 chapters", twice wrong)
    expect(screen.getByText('about a minute')).toBeOnTheScreen();
    expect(screen.queryByText(/chapters/)).not.toBeOnTheScreen();

    // The venue grammar rides under the hero (112m rounds to the 1-min floor)
    expect(screen.getByText(/Go · 1 min walk/)).toBeOnTheScreen();
    expect(screen.getByText('Compass')).toBeOnTheScreen();
    // No bare source name under the pills any more: the byline and the
    // single citation carry it — this was the third "Wikipedia" on a
    // screen defended against a guideline about collections of links
    expect(screen.queryByText('Wikipedia')).not.toBeOnTheScreen();

    // No retelling exists → the TELLING opens the story (App Store
    // 4.2.2: the AI-told opening is the first thing read, with Listen)
    expect(await screen.findByTestId('telling-lead')).toBeOnTheScreen();
    expect(
      screen.getByText('The compter held debtors two centuries before the railway ate it.')
    ).toBeOnTheScreen();
    // Words, not glyphs: no ✦ for VoiceOver to call "four-pointed star"
    expect(screen.getByText('Told by AI from Wikipedia — source below')).toBeOnTheScreen();

    // …and the SOURCE ARTICLE IS NOT REPUBLISHED beneath it. It used to
    // be, in full, under a "From Wikipedia" eyebrow — and since eleven of
    // the twenty nearest Greenwich places fall under the retelling gate,
    // that was the majority of screens. App Review cited 4.2.2 three
    // times for "content aggregated from the Internet"; against that
    // screen the sentence was accurate.
    expect(screen.queryByText('The intro, the surprising true thing.')).not.toBeOnTheScreen();
    expect(screen.queryByText('Built by the Borough in 1791.')).not.toBeOnTheScreen();
    expect(screen.queryByText('Torn down for the railway in 1855.')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Construction')).toBeNull();

    // What stands in its place: one citation to the source we read
    // ONE citation, reading as attribution. Two labels on a screen whose
    // meta line already says "Wikipedia" was three mentions of it.
    expect(screen.getByText('Source: Wikipedia ›')).toBeOnTheScreen();
    expect(screen.queryByText('Wikipedia · source')).not.toBeOnTheScreen();
    expect(screen.getByTestId('wikipedia-link')).toHaveStyle({
      backgroundColor: '#EFEAFC',
      borderRadius: 14,
    });
  });

  test('the Save pill toggles: Save → Saved → Save, shelf and pill in the same frame', async () => {
    const { setSavedForTests, isSaved } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@/data/saved') as typeof import('@/data/saved');
    setSavedForTests([]);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    const pill = await screen.findByTestId('save-button');
    expect(screen.getByText('Save')).toBeOnTheScreen();

    fireEvent.press(pill);
    expect(await screen.findByText('Saved')).toBeOnTheScreen();
    expect(isSaved(42)).toBe(true);

    fireEvent.press(pill);
    expect(await screen.findByText('Save')).toBeOnTheScreen();
    expect(isSaved(42)).toBe(false);
  });

  test('the journey controls clear 44pt — a primary button is not a 36pt target', async () => {
    // 8pt of padding around a 20pt label was a 36pt Go button
    // (DESIGN.md: every tap target clears 44pt)
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    await screen.findByTestId('save-button');
    for (const control of [
      screen.getByText(/^Go( · )?/).parent,
      screen.getByTestId('compass-button'),
      screen.getByTestId('save-button'),
    ]) {
      expect(control).toHaveStyle({ minHeight: 44 });
    }
  });

  test('without a live fix the button says Go alone — no fabricated walk time', async () => {
    // Denied location: the feed's distanceMeters was measured from the
    // fallback pin, and quoting it would be the lie the shelf card
    // already refuses to tell
    mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null } as never);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('Go')).toBeOnTheScreen();
    expect(screen.queryByText(/Go · /)).not.toBeOnTheScreen();
    // (#243's meta line is gone with the source-name dedupe — nothing
    // left under the pills to wrap)
  });

  test('a network failure names the cause and offers the ask again — never "could not be found"', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '4242' }); // not in any cache
    mockExpoFetch.mockRejectedValueOnce(new Error('flaky tunnel'));
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('This story didn’t come back')).toBeOnTheScreen();
    // What came back, not "right now" — which stands in for a cause
    expect(screen.getByText('The link is good — the request wasn’t.')).toBeOnTheScreen();
    expect(screen.queryByText(/right now/)).not.toBeOnTheScreen();
    expect(screen.queryByText('This story could not be found.')).not.toBeOnTheScreen();

    // The retry refetches — this time the story answers
    mockExpoFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          pageId: 4242,
          title: 'Marshalsea',
          coordinates: { latitude: 51.5012, longitude: -0.0921 },
          distanceMeters: 300,
          extract: 'A prison on the south bank of the Thames.',
          url: 'https://en.wikipedia.org/wiki/Marshalsea',
          source: 'Wikipedia',
        },
      }),
    });
    fireEvent.press(screen.getByTestId('retry-story'));
    // A press, a refetch and a whole gazetteer mount: RNTL's 1s default
    // is tight for that once the suite is running in parallel
    expect(await screen.findByText('Marshalsea', {}, { timeout: 5000 })).toBeOnTheScreen();
  });

  test('a true 404 still says the story could not be found — and offers no retry', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '4243' });
    mockExpoFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('This story could not be found.')).toBeOnTheScreen();
    // Absence keeps its own grammar: no panel, and no button to press
    // against an answer that will not change
    expect(screen.queryByTestId('retry-story')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('load-failed-story')).not.toBeOnTheScreen();
  });

  test('the Compass button opens the story compass modal', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    fireEvent.press(screen.getByTestId('compass-button'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]/compass',
      params: { pageId: '42' },
    });
  });

  test('a place with NO article of its own is still NAMED, and keeps the record story', async () => {
    (fetchArticle as jest.Mock).mockImplementationOnce(noArticle);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    // #292: the name lived only in the hero, and the hero needs an
    // article — so this screen used to reach the reader without once
    // saying whose it was. It renders on the page now, same ramp.
    expect(await screen.findByTestId('gazetteer-title')).toBeOnTheScreen();
    expect(screen.getByText('Borough Compter')).toBeOnTheScreen();
    expect(screen.getByText('Wikipedia')).toBeOnTheScreen();

    expect(screen.getByText('Story')).toBeOnTheScreen();
    expect(screen.getByText(/demolished in 1855/)).toBeOnTheScreen();
    // The citation is the list's own row now, not a stray link at the
    // foot of an `empty` element (#255)
    expect(screen.getByText('Source: Wikipedia ›')).toBeOnTheScreen();
    expect(screen.queryByText('From Wikipedia')).not.toBeOnTheScreen();
    // The record HAS its own words, so nothing claims nobody wrote it
    // down — a failed article fetch is not evidence of an empty record
    expect(screen.queryByText(/nothing written under either/)).not.toBeOnTheScreen();
    // The venue grammar survives the fallback
    expect(screen.getByText(/Go · 1 min walk/)).toBeOnTheScreen();
  });

  /**
   * Direction C, "Thin ground, and where it thickens" (#292): a plaque
   * that never matched an article gets its name, one measured grey line
   * about how much the records hold, and then the neighbourhood — the
   * dead end becomes a junction.
   */
  test('an unresolved plaque: named, measured, and pointed at the ground that is better recorded', async () => {
    mockExpoFetch.mockReset();
    mockExpoFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            pageId: 3000000595,
            title: 'Jimi Hendrix',
            coordinates: { latitude: 51.51302, longitude: -0.14609 },
            distanceMeters: 20,
            extract:
              'Jimi Hendrix 1942-1970 guitarist and songwriter lived here 1968-1969',
            url: 'https://openplaques.org/plaques/595',
            source: 'Open Plaques',
          },
          {
            pageId: 91,
            title: 'Handel & Hendrix in London',
            coordinates: { latitude: 51.51304, longitude: -0.146 },
            distanceMeters: 30,
            url: 'https://en.wikipedia.org/wiki/Handel_%26_Hendrix_in_London',
            source: 'Wikipedia',
          },
          {
            pageId: 92,
            title: 'Brook Street, Mayfair',
            coordinates: { latitude: 51.5126, longitude: -0.147 },
            distanceMeters: 60,
            url: 'https://en.wikipedia.org/wiki/Brook_Street,_Mayfair',
            source: 'Wikipedia',
          },
        ],
      }),
    });
    await fetchNearbyHistory({ latitude: 51.51302, longitude: -0.14609 });
    (fetchArticle as jest.Mock).mockImplementation(noArticle);

    mockUseLocalSearchParams.mockReturnValue({ pageId: '3000000595' });
    await render(<HistoryDetailScreen />);

    // The name — filed under its subject, not the first sixty
    // characters of its own inscription
    expect(await screen.findByTestId('gazetteer-title')).toBeOnTheScreen();
    expect(screen.getByText('Jimi Hendrix')).toBeOnTheScreen();
    expect(screen.getByText('Open Plaques')).toBeOnTheScreen();
    // The inscription still stands, whole, where the primary source goes
    expect(screen.getByText('The plaque reads')).toBeOnTheScreen();
    expect(screen.getByText(/guitarist and songwriter lived here/)).toBeOnTheScreen();

    // One measured grey line — a measurement, not an apology
    expect(
      await screen.findByText('The plaque is the whole record — no article stands behind it.')
    ).toBeOnTheScreen();

    // …then where the ground thickens
    expect(screen.getByText('Also within a walk · 2')).toBeOnTheScreen();
    expect(screen.getByText('Handel & Hendrix in London')).toBeOnTheScreen();
    expect(screen.getByText('Brook Street, Mayfair')).toBeOnTheScreen();

    // The citation names what it actually opens — this link goes to
    // openplaques.org, and used to say "Source: Wikipedia"
    expect(screen.getByText('Source: Open Plaques ›')).toBeOnTheScreen();

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    (fetchArticle as jest.Mock).mockResolvedValue({ minutes: 3, images: [], chapters: [] });
  });

  test('a plaque with a resolved subject opens the SUBJECT gazetteer, inscription in view', async () => {
    cacheHistoryItems([
      {
        pageId: 3000031040,
        title: 'Deptford Creek. This is the mouth of the River…',
        coordinates: { latitude: 51.4814, longitude: -0.01613 },
        distanceMeters: 200,
        extract: 'Deptford Creek. This is the mouth of the River Ravensbourne, first bridged in 1804.',
        url: 'https://openplaques.org/plaques/31040',
        source: 'Open Plaques',
        subject: 'River Ravensbourne',
      },
    ]);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '3000031040' });
    await render(<HistoryDetailScreen />);

    // The hero tells the SUBJECT's story, not the inscription's
    expect(await screen.findByText('River Ravensbourne')).toBeOnTheScreen();
    // The plaque itself stays in view — primary source on the ground
    expect(screen.getByText('The plaque reads')).toBeOnTheScreen();
    expect(screen.getByText(/first bridged in 1804/)).toBeOnTheScreen();
  });

  test('cold start (a shared deep link): cache miss fetches the story, then renders it', async () => {
    // Nothing has cached pageId 777 — the recipient opened
    // landmarks://history/777 on a fresh app
    mockExpoFetch.mockReset();
    mockExpoFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        item: {
          pageId: 777,
          title: 'Marshalsea',
          coordinates: { latitude: 51.5014, longitude: -0.0921 },
          distanceMeters: 0,
          extract: 'A notorious prison on the south bank of the Thames.',
          url: 'https://en.wikipedia.org/wiki/Marshalsea',
          source: 'Wikipedia',
        },
      }),
    });
    mockUseLocalSearchParams.mockReturnValue({ pageId: '777' });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('Marshalsea')).toBeOnTheScreen();
    expect(String(mockExpoFetch.mock.calls[0][0])).toContain('/api/story?pageId=777');
    expect(screen.queryByText('This story could not be found.')).not.toBeOnTheScreen();
  });

  test('while the cold-start fetch is in flight, the screen waits — never a false not-found', async () => {
    mockExpoFetch.mockReset();
    mockExpoFetch.mockReturnValue(new Promise(() => {})); // never resolves
    mockUseLocalSearchParams.mockReturnValue({ pageId: '778' });
    await render(<HistoryDetailScreen />);

    expect(screen.getByTestId('story-loading')).toBeOnTheScreen();
    expect(screen.queryByText('This story could not be found.')).not.toBeOnTheScreen();
  });

  test('the web of history is bounded to the feed: an in-feed mention links, a cached-but-out-of-area title stays prose', async () => {
    // The feed this story arrived in — its neighbourhood
    mockExpoFetch.mockReset();
    mockExpoFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            pageId: 60,
            title: 'Rotherhithe Tunnel',
            coordinates: { latitude: 51.501, longitude: -0.0525 },
            distanceMeters: 90,
            url: 'https://en.wikipedia.org/wiki/Rotherhithe_Tunnel',
            source: 'Wikipedia',
          },
          {
            pageId: 61,
            title: 'Brunel Engine House',
            coordinates: { latitude: 51.5015, longitude: -0.0528 },
            distanceMeters: 140,
            url: 'https://en.wikipedia.org/wiki/Brunel_Engine_House',
            source: 'Wikipedia',
          },
        ],
      }),
    });
    await fetchNearbyHistory({ latitude: 51.501, longitude: -0.0525 });

    // Cached from another town last week: in the item store, NOT this feed
    cacheHistoryItems([
      {
        pageId: 62,
        title: 'Tinside Lido',
        coordinates: { latitude: 50.363, longitude: -4.141 },
        distanceMeters: 340,
        url: 'https://en.wikipedia.org/wiki/Tinside_Pool',
        source: 'Wikipedia',
      },
    ]);

    (fetchRetold as jest.Mock).mockResolvedValueOnce({
      minutes: 4,
      timeline: [],
      parts: [
        {
          heading: 'Under the river',
          body: 'Steam from the Brunel Engine House drove the pumps dry. Weary diggers dreamed of Tinside Lido.',
        },
      ],
    });

    mockUseLocalSearchParams.mockReturnValue({ pageId: '60' });
    await render(<HistoryDetailScreen />);

    // A linked mention renders as its own text segment; unlinked prose
    // stays embedded in the paragraph — so exact-text queries tell
    // doors from prose
    expect(await screen.findByText('Brunel Engine House')).toBeOnTheScreen();
    expect(screen.queryByText('Tinside Lido')).not.toBeOnTheScreen();
    expect(screen.getByText(/dreamed of Tinside Lido/)).toBeOnTheScreen();
    // The retold story ends in a link out to the source — the browser,
    // not an inline door
    expect(await screen.findByTestId('wikipedia-link')).toHaveStyle({
      backgroundColor: '#EFEAFC',
      borderRadius: 14,
    });
    expect(screen.getByText('Source: Wikipedia ›')).toBeOnTheScreen();
    expect(screen.queryByText('Read the original article ›')).not.toBeOnTheScreen();

    // The retold rows give VirtualizedList a follow-up render batch on
    // a timer — let it fire inside act so the test ends quiet
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });

  test('a true 404 keeps the not-found branch', async () => {
    mockExpoFetch.mockReset();
    mockExpoFetch.mockResolvedValue({ ok: false, status: 404 });
    mockUseLocalSearchParams.mockReturnValue({ pageId: '999' });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('This story could not be found.')).toBeOnTheScreen();
  });

  /**
   * The telling is Venture's own prose, and the two things that matter
   * about it here are that it names the source it was written from
   * (a hardcoded "Wikipedia" became false the moment a resolved listed
   * building rendered one) and that a failure is spoken rather than
   * swallowed — returning null left the fetched article standing alone
   * as the whole story, which is the aggregation 4.2.2 cites.
   */
  describe('the authored telling', () => {
    const fetchTellingMock = jest.requireMock('@/data/telling-client')
      .fetchTelling as jest.Mock;

    beforeAll(() => {
      cacheHistoryItems([
        {
          pageId: 77,
          title: 'Ardencaple Castle',
          coordinates: { latitude: 51.5045, longitude: -0.0905 },
          distanceMeters: 90,
          extract: 'A tower house held by the MacAulays, largely demolished in 1957.',
          thumbnailUrl: 'https://upload.wikimedia.org/ardencaple.jpg',
          url: 'https://en.wikipedia.org/wiki/Ardencaple_Castle',
          // What heritage.ts actually badges a listed building with once
          // its Wikipedia story is found — a real, reachable source string
          source: 'Wikipedia \u00b7 Grade II listed',
        },
      ]);
    });

    test('names the source it was written from, not a hardcoded Wikipedia', async () => {
      mockUseLocalSearchParams.mockReturnValue({ pageId: '77' });
      await render(<HistoryDetailScreen />);

      expect(await screen.findByTestId('telling-lead')).toBeOnTheScreen();
      expect(
        screen.getByText('Told by AI from Wikipedia \u00b7 Grade II listed \u2014 source below')
      ).toBeOnTheScreen();

      await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    });

    test('a failed telling says so and offers the retry — it never leaves the source alone', async () => {
      fetchTellingMock.mockRejectedValueOnce(new Error('breaker open'));
      mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
      await render(<HistoryDetailScreen />);

      expect(await screen.findByTestId('telling-failed')).toBeOnTheScreen();
      expect(screen.getByText('Couldn\u2019t write the telling just now.')).toBeOnTheScreen();
      expect(screen.queryByTestId('telling-lead')).not.toBeOnTheScreen();

      // The retry writes it — the authored prose arrives without a reload
      fireEvent.press(screen.getByTestId('telling-retry'));

      expect(await screen.findByTestId('telling-lead')).toBeOnTheScreen();
      expect(
        screen.getByText('The compter held debtors two centuries before the railway ate it.')
      ).toBeOnTheScreen();

      await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    });
  });
});

/**
 * #292's CLASS, not its instance. "The name always renders" is a rule
 * about every story shape, so it is tested over every story shape — a
 * new one cannot slip in nameless. The name lived only in `Hero`, which
 * mounts on `article && areaName`, so the shapes that never resolve an
 * article (the majority of plaques and every bare register entry) drew
 * a screen that said Go, Compass, Save and nothing whatever about what
 * you were looking at.
 *
 * Assertions are on the RENDERED screen: what a reader gets, not what
 * the row builder was handed.
 */
describe('a story screen names what it is about — every shape', () => {
  const shapes: {
    what: string;
    item: HistoryItem;
    /** Does an article resolve for it? */
    article: boolean;
    /** The name a reader must see. */
    name: string;
    /** Where it renders: the photographic block, or the plain one. */
    block: 'gazetteer-hero' | 'gazetteer-title';
  }[] = [
    {
      what: 'a Wikipedia place whose article resolves',
      item: {
        pageId: 5001,
        title: 'Borough Compter',
        coordinates: { latitude: 51.5045, longitude: -0.0905 },
        distanceMeters: 112,
        extract: 'A small compter or prison in Southwark, demolished in 1855.',
        url: 'https://en.wikipedia.org/wiki/Borough_Compter',
        source: 'Wikipedia',
      },
      article: true,
      name: 'Borough Compter',
      block: 'gazetteer-hero',
    },
    {
      what: 'a plaque with an inscription and no article',
      item: {
        pageId: 5002,
        title: 'Jimi Hendrix',
        coordinates: { latitude: 51.51302, longitude: -0.14609 },
        distanceMeters: 20,
        extract: 'Jimi Hendrix 1942-1970 guitarist and songwriter lived here 1968-1969',
        url: 'https://openplaques.org/plaques/595',
        source: 'Open Plaques',
      },
      article: false,
      name: 'Jimi Hendrix',
      block: 'gazetteer-title',
    },
    {
      what: 'a listed building with a grade and no extract',
      item: {
        pageId: 5003,
        title: 'Telephone Kiosks, Broad Court',
        coordinates: { latitude: 51.5135, longitude: -0.1221 },
        distanceMeters: 240,
        url: 'https://historicengland.org.uk/listing/the-list/list-entry/1066301',
        source: 'Historic England · Grade II',
      },
      article: false,
      name: 'Telephone Kiosks, Broad Court',
      block: 'gazetteer-title',
    },
    {
      what: 'a bare pin with nothing written under it at all',
      item: {
        pageId: 5004,
        title: 'Bow Street',
        coordinates: { latitude: 51.5132, longitude: -0.1224 },
        distanceMeters: 320,
        url: 'https://en.wikipedia.org/wiki/Bow_Street',
        source: 'Wikipedia',
      },
      article: false,
      name: 'Bow Street',
      block: 'gazetteer-title',
    },
    {
      what: 'a plaque whose subject resolved to its own article',
      item: {
        pageId: 5005,
        title: 'Deptford Creek. This is the mouth of the River…',
        coordinates: { latitude: 51.4814, longitude: -0.01613 },
        distanceMeters: 200,
        extract: 'Deptford Creek. This is the mouth of the River Ravensbourne, first bridged in 1804.',
        url: 'https://openplaques.org/plaques/31040',
        source: 'Open Plaques',
        subject: 'River Ravensbourne',
      },
      article: true,
      name: 'River Ravensbourne',
      block: 'gazetteer-hero',
    },
  ];

  // Once, not once per test: caching an item persists it, and doing
  // that inside two `each` tables is churn on the same thread the
  // render runs on
  beforeAll(() => {
    cacheHistoryItems(shapes.map((shape) => shape.item));
  });

  test.each(shapes)('$what', async ({ item, article, name, block }) => {
    (fetchArticle as jest.Mock).mockResolvedValue(
      article ? { minutes: 3, images: [], chapters: [] } : null
    );
    mockUseLocalSearchParams.mockReturnValue({ pageId: String(item.pageId) });
    await render(<HistoryDetailScreen />);

    // The name is on the screen, in the block that owns it
    expect(await screen.findByTestId(block)).toBeOnTheScreen();
    expect(screen.getByText(name)).toBeOnTheScreen();
    // …and the screen never reaches the reader with only its controls
    expect(screen.queryByTestId('story-screen')).toBeOnTheScreen();

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });

  /**
   * The other half of DESIGN.md's Glass rule, over the same shapes: the
   * material follows what the chip sits ON. A hero means a photograph
   * and a pinned-dark chip under a white glyph; no hero means the page,
   * and the island's own rendering in the theme's ink.
   */
  test.each(shapes)('$what — the back chip takes the material of what it sits on', async ({
    item,
    article,
    block,
  }) => {
    (fetchArticle as jest.Mock).mockResolvedValue(
      article ? { minutes: 3, images: [], chapters: [] } : null
    );
    mockUseLocalSearchParams.mockReturnValue({ pageId: String(item.pageId) });
    await render(<HistoryDetailScreen />);
    await screen.findByTestId(block);

    const chip = screen.getByTestId('back-chip');
    if (block === 'gazetteer-hero') {
      // Over a photograph: the fixed dark scrim, white chevron
      expect(chip).toHaveStyle({ backgroundColor: 'rgba(20, 20, 24, 0.75)' });
      expect(screen.getByText('‹')).toHaveStyle({ color: '#FFFFFF' });
    } else {
      // On the page: the island's translucency, and the theme's ink
      expect(chip).toHaveStyle({ backgroundColor: 'rgba(245, 245, 247, 0.88)' });
      expect(screen.getByText('‹')).toHaveStyle({ color: '#17181A' });
      expect(screen.getByText('‹')).not.toHaveStyle({ color: '#FFFFFF' });
    }

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });

  test('in dark, the page chip follows the app rather than the photograph', async () => {
    mockScheme.mockReturnValue('dark');
    (fetchArticle as jest.Mock).mockImplementation(noArticle);
    mockUseLocalSearchParams.mockReturnValue({ pageId: String(shapes[3].item.pageId) });
    await render(<HistoryDetailScreen />);
    await screen.findByTestId('gazetteer-title');

    expect(screen.getByTestId('back-chip')).toHaveStyle({
      backgroundColor: 'rgba(30, 30, 34, 0.86)',
    });

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });
});

/**
 * DESIGN.md: text on an accent surface takes `theme.background`, never
 * white — #FFFFFF on the DARK accent is 2.79:1, the exact ratio the
 * palette names when it forbids this. Light mode cannot see the bug at
 * all (background IS white there), which is why it survived: the test
 * has to be run in the scheme where it bites.
 */
describe('Go, on the violet', () => {
  // Self-sufficient: this block caches its own story and pins its own
  // location, so it proves what it claims when run alone
  beforeEach(() => {
    cacheHistoryItems([
      {
        pageId: 5100,
        title: 'Marshalsea',
        coordinates: { latitude: 51.5012, longitude: -0.0921 },
        distanceMeters: 300,
        extract: 'A prison on the south bank of the Thames.',
        url: 'https://en.wikipedia.org/wiki/Marshalsea',
        source: 'Wikipedia',
      },
    ]);
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.5012, longitude: -0.0921 },
    });
    (fetchArticle as jest.Mock).mockImplementation(noArticle);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '5100' });
  });

  test('dark: the label takes the background token, not white', async () => {
    mockScheme.mockReturnValue('dark');
    await render(<HistoryDetailScreen />);

    const go = await screen.findByText(/^Go/);
    expect(go).toHaveStyle({ color: '#000000' });
    expect(go).not.toHaveStyle({ color: '#FFFFFF' });

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });

  test('light: it is the background token there too — the same rule, not a special case', async () => {
    mockScheme.mockReturnValue('light');
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText(/^Go/)).toHaveStyle({ color: '#FFFFFF' });

    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });
});
