/**
 * The events-are-history split (Edd's ruling): an article ABOUT an
 * event — a rail crash, a battle — carries event:true from the server
 * and must land in the History archive, never the Nearby feed, even
 * with a photo and no pastTag. The Lewisham rail crash was the
 * evidence: photographed, geotagged at the crash site, rendered in
 * Nearby as "· N min walk" to a train wreck.
 */
import { render, waitFor } from '@testing-library/react-native';

import { HistoryArchiveScreen, HistoryBody } from '@/components/section-screen';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const lewisham: Coordinates = { latitude: 51.4657, longitude: -0.0242 };

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: () => 'Lewisham',
}));

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn().mockResolvedValue([]),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

jest.mock('@/components/one-door', () => ({
  useOneDoorDismissed: () => true,
}));

// The archive's renderer is its own tested surface (gazetteer-rows) —
// here it only needs to show which relics the split routed to it
jest.mock('@/components/area-gazetteer', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AreaGazetteer: ({ relics }: { relics: HistoryItem[] }) => (
      <>
        {relics.map((item) => (
          <Text key={item.pageId}>{`relic: ${item.title}`}</Text>
        ))}
      </>
    ),
  };
});

const story = (
  overrides: Partial<HistoryItem> & { pageId: number; title: string }
): HistoryItem => ({
  // ~1km from the center: nothing within standing-on reach
  coordinates: { latitude: 51.4747, longitude: -0.0242 },
  distanceMeters: 1000,
  thumbnailUrl: 'https://img/x.jpg',
  url: 'https://x',
  source: 'Wikipedia',
  ...overrides,
});

// The ruling's evidence case: photographed, no pastTag, flagged
const crash = story({ pageId: 9, title: 'Lewisham rail crash', event: true });
const church = story({ pageId: 3, title: 'St Mary the Virgin, Lewisham' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: lewisham });
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [crash, church] },
    refresh: jest.fn(),
  });
});

describe('the Nearby feed', () => {
  test('a flagged event never lists as a walkable story — photo or no photo', async () => {
    const screen = await render(<HistoryBody center={lewisham} />);
    expect(screen.getByText('1 story within a walk')).toBeOnTheScreen();
    expect(screen.queryByText('Lewisham rail crash')).toBeNull();
    expect(screen.getByText('St Mary the Virgin, Lewisham')).toBeOnTheScreen();
  });
});

describe('the History archive', () => {
  test('the split routes the flagged event to the relics', async () => {
    const screen = await render(<HistoryArchiveScreen />);
    await waitFor(() => expect(screen.getByText('relic: Lewisham rail crash')).toBeOnTheScreen());
    // The standing, photographed church stays Nearby-only
    expect(screen.queryByText('relic: St Mary the Virgin, Lewisham')).toBeNull();
  });
});
