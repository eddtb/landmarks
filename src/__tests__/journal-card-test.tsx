/**
 * The quiet ledger on the card: a read or visited story drops its hook
 * and wears the glass tick on its photo — never the old whole-card dim,
 * which washed photos out until they read as broken (Edd's phone,
 * 2026-08-06). Cards without a photo keep the grey meta word.
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

const photographed: HistoryItem = {
  ...item,
  thumbnailUrl: 'https://upload.wikimedia.org/x.jpg',
};

describe('<HistoryCard /> journal treatment', () => {
  beforeEach(() => {
    setJournalForTests({});
  });

  test('an unjournaled card keeps its hook, full strength, no tick', async () => {
    await render(<HistoryCard item={photographed} />);

    expect(screen.getByText(/stood here until 1855/)).toBeOnTheScreen();
    expect(screen.getByText('2 min walk · Wikipedia')).toBeOnTheScreen();
    expect(screen.queryByTestId('read-tick')).toBeNull();
  });

  test('a read story wears the glass tick on its photo — never a dim', async () => {
    setJournalForTests({ 42: { readAt: Date.now() } });
    await render(<HistoryCard item={photographed} />);

    expect(screen.getByTestId('read-tick')).toBeOnTheScreen();
    expect(screen.getByText(/Read/)).toBeOnTheScreen();
    // The tick says it; the meta line no longer repeats it
    expect(screen.getByText('2 min walk · Wikipedia')).toBeOnTheScreen();
    // The hook is the reason to tap; a read story needs none
    expect(screen.queryByText(/stood here until 1855/)).not.toBeOnTheScreen();
    // The wash is gone for good
    expect(screen.getByTestId('history-card')).not.toHaveStyle({ opacity: 0.62 });
  });

  test('a visited story ticks with when, and visited outranks read', async () => {
    setJournalForTests({ 42: { readAt: Date.now(), visitedAt: Date.now() } });
    await render(<HistoryCard item={photographed} />);

    expect(screen.getByTestId('read-tick')).toBeOnTheScreen();
    expect(screen.getByText(/Visited today/)).toBeOnTheScreen();
  });

  test('a photoless card has nowhere to hang a tick — the meta word stays', async () => {
    setJournalForTests({ 42: { readAt: Date.now() } });
    await render(<HistoryCard item={item} />);

    expect(screen.queryByTestId('read-tick')).toBeNull();
    expect(screen.getByText('2 min walk · Wikipedia · Read')).toBeOnTheScreen();
  });

  test('the shelf card keeps its no-walk-time meta, plus the word', async () => {
    setJournalForTests({ 42: { readAt: Date.now() } });
    await render(<HistoryCard item={item} saved />);

    expect(screen.getByText('Wikipedia · Read')).toBeOnTheScreen();
  });
});
