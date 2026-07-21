import { render, screen } from '@testing-library/react-native';

import HistoryDetailScreen from '@/app/history/[pageId]';
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
    chapters: [
      { title: '', paragraphs: ['The intro, already shown as the extract.'] },
      { title: 'Construction', paragraphs: ['Built by the Borough in 1791.', 'Rebuilt twice.'] },
      { title: 'Demolition', paragraphs: ['Torn down for the railway in 1855.'] },
    ],
  })),
}));



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

  test('renders the venue-grammar story screen', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '42' });
    await render(<HistoryDetailScreen />);

    expect(screen.getByText('Borough Compter')).toBeOnTheScreen();
    // 112m at walking pace rounds to the 1-minute floor
    expect(screen.getByText(/History · 1 min walk · Wikipedia/)).toBeOnTheScreen();
    expect(screen.getByText(/Go · 1 min walk/)).toBeOnTheScreen();
    expect(screen.getByText('＋ Walk')).toBeOnTheScreen();
    expect(screen.getByText('Story')).toBeOnTheScreen();
    expect(screen.getByText(/Listen · about a minute/)).toBeOnTheScreen();
    expect(screen.getByText(/demolished in 1855/)).toBeOnTheScreen();
    expect(screen.getByText('From Wikipedia')).toBeOnTheScreen();

    // The folds (direction B): first chapter open, the rest peeking;
    // the intro chapter never repeats as a fold
    expect(await screen.findByText(/The full story · 3 min read/)).toBeOnTheScreen();
    expect(screen.getByText('Built by the Borough in 1791.')).toBeOnTheScreen();
    expect(screen.getByText('Torn down for the railway in 1855.')).toBeOnTheScreen(); // the peek
    expect(screen.queryByText('The intro, already shown as the extract.')).not.toBeOnTheScreen();
  });

  test('handles unknown pages gracefully', async () => {
    mockUseLocalSearchParams.mockReturnValue({ pageId: '999' });
    await render(<HistoryDetailScreen />);

    expect(screen.getByText('This story could not be found.')).toBeOnTheScreen();
  });
});
