import { render, screen } from '@testing-library/react-native';

import HistoryDetailScreen from '@/app/history/[pageId]';
import { fetchArticle } from '@/data/article-client';
import { cacheHistoryItems } from '@/data/history-client';

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

jest.mock('@/data/article-client', () => ({
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

    // No retelling exists → the original article stands as the story:
    // intro first, then the folds (first chapter open, the rest peeking)
    expect(await screen.findByText('The intro, the surprising true thing.')).toBeOnTheScreen();
    expect(screen.getByText('Built by the Borough in 1791.')).toBeOnTheScreen();
    expect(screen.getByText('Torn down for the railway in 1855.')).toBeOnTheScreen();
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

  test('handles unknown pages gracefully', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '999' });
    await render(<HistoryDetailScreen />);

    expect(screen.getByText('This story could not be found.')).toBeOnTheScreen();
  });
});
