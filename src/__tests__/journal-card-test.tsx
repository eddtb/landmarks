/**
 * The quiet ledger on the card (journal mock A): a read or visited
 * story dims, drops its hook, and says so in a grey word on the meta
 * line — state is words and dimming, never colour.
 */
import { render, screen } from '@testing-library/react-native';

import { HistoryCard } from '@/components/history-card';
import { setJournalForTests } from '@/data/journal';
import { HistoryItem } from '@/types/history';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const item: HistoryItem = {
  pageId: 42,
  title: 'Borough Compter',
  coordinates: { latitude: 51.5045, longitude: -0.0905 },
  distanceMeters: 160,
  extract: 'A small prison in Southwark stood here until 1855.',
  url: 'https://en.wikipedia.org/wiki/Borough_Compter',
  source: 'Wikipedia',
};

describe('<HistoryCard /> journal treatment', () => {
  beforeEach(() => {
    setJournalForTests({});
  });

  test('an unjournaled card keeps its hook and stays fully lit', async () => {
    await render(<HistoryCard item={item} />);

    expect(screen.getByText(/stood here until 1855/)).toBeOnTheScreen();
    expect(screen.getByText('2 min walk · Wikipedia')).toBeOnTheScreen();
    expect(screen.getByTestId('history-card')).not.toHaveStyle({ opacity: 0.62 });
  });

  test('a read story stops shouting: dimmed, hookless, marked in words', async () => {
    setJournalForTests({ 42: { readAt: Date.now() } });
    await render(<HistoryCard item={item} />);

    expect(screen.getByText('2 min walk · Wikipedia · Read')).toBeOnTheScreen();
    expect(screen.queryByText(/stood here until 1855/)).not.toBeOnTheScreen();
    expect(screen.getByTestId('history-card')).toHaveStyle({ opacity: 0.62 });
  });

  test('a visited story says when, and visited outranks read', async () => {
    setJournalForTests({ 42: { readAt: Date.now(), visitedAt: Date.now() } });
    await render(<HistoryCard item={item} />);

    expect(screen.getByText('2 min walk · Wikipedia · Visited today')).toBeOnTheScreen();
  });

  test('the shelf card keeps its no-walk-time meta, plus the word', async () => {
    setJournalForTests({ 42: { readAt: Date.now() } });
    await render(<HistoryCard item={item} saved />);

    expect(screen.getByText('Wikipedia · Read')).toBeOnTheScreen();
  });
});
