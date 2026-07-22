/**
 * Sparse-area honesty at the surface: when the server widened its
 * search, the count line says so — plainly, no exclamation marks.
 */
import { render } from '@testing-library/react-native';

import { HistoryBody } from '@/components/section-screen';
import { HistoryItem } from '@/types/history';

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

const center = { latitude: 52.9089, longitude: -0.6428 };

const story = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  // ~1km away: nothing within standing-on reach
  coordinates: { latitude: 52.9179, longitude: -0.6428 },
  distanceMeters: 1000,
  thumbnailUrl: 'https://img/x.jpg',
  url: 'https://x',
  source: 'Wikipedia',
});

const items = [story(1, 'The Old Mill'), story(2, 'Village Cross'), story(3, 'Tithe Barn')];

describe('HistoryBody count line', () => {
  test('sparse: says we looked further, honestly', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items, sparse: true, horizon: 3000 },
      refresh: jest.fn(),
    });
    const { getByText } = await render(<HistoryBody center={center} />);
    expect(
      getByText('3 stories — a quieter corner, so we looked further (up to ~38 min walk)')
    ).toBeOnTheScreen();
  });

  test("sparse: the walk time is DERIVED from the server's horizon, not hardcoded", async () => {
    // A different radius must change the copy — the server can no
    // longer make the count line lie by widening (or narrowing) alone
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items, sparse: true, horizon: 1500 },
      refresh: jest.fn(),
    });
    const { getByText } = await render(<HistoryBody center={center} />);
    expect(
      getByText('3 stories — a quieter corner, so we looked further (up to ~19 min walk)')
    ).toBeOnTheScreen();
  });

  test('sparse without a horizon (a feed persisted before the field): the legacy 3000m phrasing', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items, sparse: true },
      refresh: jest.fn(),
    });
    const { getByText } = await render(<HistoryBody center={center} />);
    expect(getByText(/up to ~38 min walk/)).toBeOnTheScreen();
  });

  test('dense: the everyday count line, untouched', async () => {
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items },
      refresh: jest.fn(),
    });
    const { getByText, queryByText } = await render(<HistoryBody center={center} />);
    expect(getByText('3 stories within a walk')).toBeOnTheScreen();
    expect(queryByText(/quieter corner/)).toBeNull();
  });
});
