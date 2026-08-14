/**
 * The events-are-history split (Edd's ruling): an article ABOUT an
 * event — a rail crash, a battle — carries event:true from the server
 * and must land in the History archive, never the Nearby feed, even
 * with a photo and no pastTag. The Lewisham rail crash was the
 * evidence: photographed, geotagged at the crash site, rendered in
 * Nearby as "· N min walk" to a train wreck.
 */
import { render, waitFor } from '@testing-library/react-native';

import { FeedCountLine, HistoryArchiveScreen, HistoryBody } from '@/components/section-screen';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const lewisham: Coordinates = { latitude: 51.4657, longitude: -0.0242 };

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

/**
 * The hook's REAL shape. This used to be `() => 'Lewisham'`, a bare
 * string — so every consumer's `{ name, label, settled }` destructured
 * to three `undefined`s and both screens rendered a state the app
 * cannot reach: no area name to fetch by, no label to print, and
 * "settled" never true. Nothing in the file looked at any of them, so
 * the mock could be any shape at all and stay green.
 */
jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: () => ({ name: 'Lewisham, London', label: 'Lewisham', settled: true }),
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

// The archive's renderer is its own tested surface (gazetteer-rows,
// no-republication) — here the stub reports what the tab HANDED it:
// which relics the split routed, and which place the screen thinks it
// is about. The second half is what the string-shaped hook mock made
// unaskable.
jest.mock('@/components/area-gazetteer', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    AreaGazetteer: ({
      relics,
      areaName,
      areaLabel,
    }: {
      relics: HistoryItem[];
      areaName: string | null;
      areaLabel?: string | null;
    }) => (
      <>
        <Text>{`fetches: ${areaName}`}</Text>
        <Text>{`titled: ${areaLabel}`}</Text>
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
const area = story({ pageId: 8, title: 'Lewisham', area: true });
const church = story({ pageId: 3, title: 'St Mary the Virgin, Lewisham' });

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: lewisham });
  mockUseHistory.mockReturnValue({
    state: { status: 'ready', items: [crash, area, church] },
    refresh: jest.fn(),
  });
});

describe('the Nearby feed', () => {
  test('a flagged event never lists as a walkable story — photo or no photo', async () => {
    const screen = await render(<><HistoryBody center={lewisham} onManualCenter={jest.fn()} /><FeedCountLine center={lewisham} /></>);
    expect(screen.getByText('1 story within a walk')).toBeOnTheScreen();
    expect(screen.queryByText('Lewisham rail crash')).toBeNull();
    expect(screen.queryByText('Lewisham')).toBeNull();
    expect(screen.getByText('St Mary the Virgin, Lewisham')).toBeOnTheScreen();
  });
});

describe('the History archive', () => {
  test('the split routes the flagged event to the relics', async () => {
    const screen = await render(<HistoryArchiveScreen />);
    await waitFor(() => expect(screen.getByText('relic: Lewisham rail crash')).toBeOnTheScreen());
    expect(screen.getByText('relic: Lewisham')).toBeOnTheScreen();
    // The standing, photographed church stays Nearby-only
    expect(screen.queryByText('relic: St Mary the Virgin, Lewisham')).toBeNull();
  });

  test('…and the archive knows which place it is the archive OF', async () => {
    // The two names do two different jobs and are not interchangeable:
    // the ARTICLE TITLE is what every fetch and filter keys off, and the
    // label is only how the place is said. Fetching by the label finds
    // the wrong article (bare "Sydenham" is a disambiguation page); a
    // title in the hero says "Lewisham, London" to a reader standing in
    // Lewisham. Neither could be seen while the hook returned a string.
    const screen = await render(<HistoryArchiveScreen />);

    await waitFor(() => expect(screen.getByText('fetches: Lewisham, London')).toBeOnTheScreen());
    expect(screen.getByText('titled: Lewisham')).toBeOnTheScreen();
  });
});
