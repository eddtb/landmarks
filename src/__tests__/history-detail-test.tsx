import { act, render, screen } from '@testing-library/react-native';

import HistoryDetailScreen from '@/app/history/[pageId]';
import { fetchArticle } from '@/data/article-client';
import { cacheHistoryItems, fetchNearbyHistory } from '@/data/history-client';
import { fetchRetold } from '@/data/retold-client';

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
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

describe('<HistoryDetailScreen />', () => {
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
    expect(screen.getByText('Wikipedia')).toBeOnTheScreen();

    // No retelling exists → the original article stands as the story
    // IN FULL: intro first, then the folds (first chapter open, the
    // rest peeking) — not shortened behind a door
    expect(await screen.findByText('The intro, the surprising true thing.')).toBeOnTheScreen();
    expect(screen.getByText('Built by the Borough in 1791.')).toBeOnTheScreen();
    expect(screen.getByText('Torn down for the railway in 1855.')).toBeOnTheScreen();
    // …and a link out to the source, which holds more than we parse
    expect(screen.getByText('Read the original article ›')).toBeOnTheScreen();
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
});
