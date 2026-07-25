import { render, screen } from '@testing-library/react-native';

import { SavedScreen } from '@/components/saved-screen';
import { setSavedForTests } from '@/data/saved';
import { HistoryItem } from '@/types/history';

const item = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 22000,
  extract: 'A nuclear reactor ran here until 1996.',
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
});

describe('<SavedScreen />', () => {
  test('while the first read is in flight the shelf shows NOTHING — no empty flash', async () => {
    setSavedForTests(null);
    await render(<SavedScreen />);

    expect(screen.getByTestId('saved-screen')).toBeOnTheScreen();
    expect(screen.queryByText(/Nothing saved yet/)).not.toBeOnTheScreen();
  });

  test('empty is a state with words, not a blank', async () => {
    setSavedForTests([]);
    await render(<SavedScreen />);

    expect(screen.getByText('Nothing saved yet — Save on any story keeps it here.')).toBeOnTheScreen();
  });

  test('saved cards show the story, the hook, the count — and NO walk time', async () => {
    setSavedForTests([
      { item: item(61, 'Brunel Engine House'), savedAt: 2 },
      { item: item(62, 'JASON reactor'), savedAt: 1 },
    ]);
    await render(<SavedScreen />);

    expect(screen.getByText('Saved · 2')).toBeOnTheScreen();
    expect(screen.getByText('Brunel Engine House')).toBeOnTheScreen();
    expect(screen.getByText('JASON reactor')).toBeOnTheScreen();
    // distanceMeters was minted in another feed, another day — the
    // shelf must not tell a 22km walk time as if it were current
    expect(screen.queryByText(/min walk/)).not.toBeOnTheScreen();
    expect(screen.getAllByText('Wikipedia').length).toBe(2);
  });
});
