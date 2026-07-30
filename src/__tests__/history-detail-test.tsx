import { act, fireEvent, render, screen } from '@testing-library/react-native';

import HistoryDetailScreen from '@/app/history/[pageId]';
import { fetchArticle } from '@/data/article-client';
import { cacheHistoryItems, fetchNearbyHistory } from '@/data/history-client';
import { fetchRetold } from '@/data/retold-client';

const mockUseLocalSearchParams = jest.fn();
const mockPush = jest.fn();

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
  // A light miss: the screen must not depend on the chapters-first
  // fast path — the full article alone still paints everything
  fetchArticleLight: jest.fn(async () => null),
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

describe('<HistoryDetailScreen />', () => {
  beforeEach(() => {
    mockUseLocation.mockReset();
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.5055, longitude: -0.0906 },
    });
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
    expect(screen.getByText(/3 min read · 3 chapters/)).toBeOnTheScreen();

    // The venue grammar rides under the hero (112m rounds to the 1-min floor)
    expect(screen.getByText(/Go · 1 min walk/)).toBeOnTheScreen();
    expect(screen.getByText('Compass')).toBeOnTheScreen();
    expect(screen.getByText('Wikipedia')).toBeOnTheScreen();

    // No retelling exists → the TELLING opens the story (App Store
    // 4.2.2: the AI-told opening is the first thing read, with Listen)
    expect(await screen.findByTestId('telling-lead')).toBeOnTheScreen();
    expect(
      screen.getByText('The compter held debtors two centuries before the railway ate it.')
    ).toBeOnTheScreen();
    // Words, not glyphs: no ✦ for VoiceOver to call "four-pointed star"
    expect(screen.getByText('Told by AI from Wikipedia — source below')).toBeOnTheScreen();

    // …and the original article still stands as the story IN FULL
    // beneath it: intro first, then the folds (first chapter open, the
    // rest peeking) — not shortened behind a door
    expect(await screen.findByText('The intro, the surprising true thing.')).toBeOnTheScreen();
    expect(screen.getByText('Built by the Borough in 1791.')).toBeOnTheScreen();
    expect(screen.getByText('Torn down for the railway in 1855.')).toBeOnTheScreen();
    // The folds tell VoiceOver which way they stand: chapter one opens
    // by default, the rest sit collapsed under their titles (their
    // first line is only the sighted peek)
    expect(screen.getByLabelText('Construction')).toBeExpanded();
    expect(screen.getByLabelText('Demolition')).toBeCollapsed();
    // …and a link out to the source, which holds more than we parse
    expect(screen.getByText('Read more on Wikipedia ›')).toBeOnTheScreen();
    expect(screen.getByText('Wikipedia · source')).toBeOnTheScreen();
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

  test('without a live fix the button says Go alone — no fabricated walk time', async () => {
    // Denied location: the feed's distanceMeters was measured from the
    // fallback pin, and quoting it would be the lie the shelf card
    // already refuses to tell
    mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null } as never);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('Go')).toBeOnTheScreen();
    expect(screen.queryByText(/Go · /)).not.toBeOnTheScreen();

    // The short Go label hands the grey meta more width — it must stay
    // a one-line annotation (tail ellipsis), never wrap mid-word (#243)
    expect(screen.getByText('Wikipedia').props.numberOfLines).toBe(1);
  });

  test('a network failure offers Try again — never "could not be found"', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '4242' }); // not in any cache
    mockExpoFetch.mockRejectedValueOnce(new Error('flaky tunnel'));
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('Couldn’t load this story right now.')).toBeOnTheScreen();
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
    fireEvent.press(screen.getByTestId('story-retry'));
    expect(await screen.findByText('Marshalsea')).toBeOnTheScreen();
  });

  test('a true 404 still says the story could not be found', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '4243' });
    mockExpoFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('This story could not be found.')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-retry')).not.toBeOnTheScreen();
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

  test('a place with NO article of its own keeps the extract story', async () => {
    (fetchArticle as jest.Mock).mockResolvedValueOnce(null);
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    expect(await screen.findByText('Story')).toBeOnTheScreen();
    expect(screen.getByText(/demolished in 1855/)).toBeOnTheScreen();
    expect(screen.getByText('From Wikipedia')).toBeOnTheScreen();
    // The venue grammar survives the fallback
    expect(screen.getByText(/Go · 1 min walk/)).toBeOnTheScreen();
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
    expect(screen.getByText('Read more on Wikipedia ›')).toBeOnTheScreen();
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
   * App Store 4.2.2 cites "content aggregated from the Internet". The
   * answer is that Venture writes its own account of a place — so that
   * account must be the first prose on the screen, on every path, with
   * the source clearly secondary. It used to be a Listen button here,
   * which left the fetched extract standing as the story.
   */
  describe('the authored telling opens the story', () => {
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
          url: 'https://historicengland.org.uk/listing/the-list/list-entry/1234567',
          source: 'Historic England',
        },
      ]);
    });

    test('a place with no article of its own still opens with our prose, not a button', async () => {
      // No Wikipedia article → the Gazetteer is empty and ExtractStory
      // stands. This is the path that used to show a bare Listen button.
      (fetchArticle as jest.Mock).mockResolvedValueOnce(null);
      (fetchRetold as jest.Mock).mockResolvedValueOnce(null);
      mockUseLocalSearchParams.mockReturnValue({ pageId: '77' });
      await render(<HistoryDetailScreen />);

      // Written on mount — no tap revealed it
      expect(await screen.findByTestId('telling-lead')).toBeOnTheScreen();
      expect(
        screen.getByText('The compter held debtors two centuries before the railway ate it.')
      ).toBeOnTheScreen();

      // Attributed to ITS source, not a hardcoded Wikipedia
      expect(screen.getByText('Told by AI from Historic England — source below')).toBeOnTheScreen();

      // …and the fetched extract is framed as the secondary record
      expect(screen.getByText('From the record')).toBeOnTheScreen();
      expect(
        screen.getByText('A tower house held by the MacAulays, largely demolished in 1957.')
      ).toBeOnTheScreen();

      await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
    });

    test('a failed telling says so and offers the retry — it never leaves the source alone', async () => {
      // The old behaviour returned null here, so a quota blip left the
      // extract as the entire story: the aggregator we are denying being
      (fetchArticle as jest.Mock).mockResolvedValueOnce(null);
      (fetchRetold as jest.Mock).mockResolvedValueOnce(null);
      fetchTellingMock.mockRejectedValueOnce(new Error('breaker open'));
      mockUseLocalSearchParams.mockReturnValue({ pageId: '77' });
      await render(<HistoryDetailScreen />);

      expect(await screen.findByTestId('telling-failed')).toBeOnTheScreen();
      expect(screen.getByText('Couldn’t write the telling just now.')).toBeOnTheScreen();
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
