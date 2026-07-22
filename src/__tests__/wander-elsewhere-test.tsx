/**
 * The wander line elsewhere (approved mocks, brand-elsewhere): the
 * shared primitive extracted from the one-door gate, the empty state's
 * static line, the cold-load self-drawing line, and the standing-on
 * banner's warm accent — plus the #208 fix that rides along: no
 * standing-on claim unless the center is a real GPS fix.
 */
import { render, waitFor } from '@testing-library/react-native';

import { StandingOnIt, StoriesScreen } from '@/components/section-screen';
import { DrawingWanderLine, WanderLine } from '@/components/wander-line';
import { Colors } from '@/constants/theme';
import { HistoryItem } from '@/types/history';
import { Coordinates, FallbackCoordinates } from '@/utils/geo';

const greenwich: Coordinates = { latitude: 51.4826, longitude: -0.0077 };

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: () => ({ name: 'Greenwich', settled: true }),
}));

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn().mockResolvedValue([]),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

// The root gate owns the door; beneath it this flag only matters in
// the 'priming' state, which these tests never enter
jest.mock('@/components/one-door', () => ({
  useOneDoorDismissed: () => true,
}));

const mockUseReducedMotion = jest.fn();
// A Proxy, not a spread: reanimated's exports are getters (the default
// export included) and a spread would drop them
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual('react-native-reanimated');
  return new Proxy(actual, {
    get: (target, prop) =>
      prop === 'useReducedMotion' ? () => mockUseReducedMotion() : target[prop],
  });
});

const story = (
  overrides: Partial<HistoryItem> & { pageId: number; title: string }
): HistoryItem => ({
  coordinates: greenwich,
  distanceMeters: 400,
  thumbnailUrl: 'https://img/x.jpg',
  url: 'https://x',
  source: 'Wikipedia',
  ...overrides,
});

function gpsLive() {
  mockUseLocation.mockReturnValue({ status: 'ready', coordinates: greenwich });
}

function gpsDenied() {
  mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseReducedMotion.mockReturnValue(false);
  mockUseHistory.mockReturnValue({ state: { status: 'ready', items: [] }, refresh: jest.fn() });
});

describe('the wander line primitive', () => {
  test('draws exactly its count of half-arcs, hidden from accessibility', async () => {
    const screen = await render(
      <WanderLine arcSpan={52} stroke={6} count={4} color="#6A4BDB" />
    );
    expect(screen.getAllByTestId('wander-arc', { includeHiddenElements: true })).toHaveLength(4);
    expect(
      screen.getByTestId('wander-line', { includeHiddenElements: true })
    ).toHaveProp('accessibilityElementsHidden', true);
  });

  test('the drawing line animates by default…', async () => {
    const screen = await render(
      <DrawingWanderLine arcSpan={64} stroke={7} count={4} color="#6A4BDB" />
    );
    expect(
      screen.getByTestId('wander-line-drawing', { includeHiddenElements: true })
    ).toBeOnTheScreen();
    expect(screen.getAllByTestId('wander-arc', { includeHiddenElements: true })).toHaveLength(4);
  });

  test('…and holds still under reduced motion', async () => {
    mockUseReducedMotion.mockReturnValue(true);
    const screen = await render(
      <DrawingWanderLine arcSpan={64} stroke={7} count={4} color="#6A4BDB" />
    );
    expect(
      screen.queryByTestId('wander-line-drawing', { includeHiddenElements: true })
    ).toBeNull();
    expect(screen.getByTestId('wander-line', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('the empty state (mock 1)', () => {
  test('the feed empty shows the static line above the wander invitation', async () => {
    gpsLive();
    const screen = await render(<StoriesScreen />);
    expect(
      await screen.findByText('No recorded history right here — wander a little.')
    ).toBeOnTheScreen();
    expect(screen.getByTestId('wander-line', { includeHiddenElements: true })).toBeOnTheScreen();
    // Static — an empty state shouldn't fidget
    expect(screen.queryByTestId('wander-line-drawing', { includeHiddenElements: true })).toBeNull();
  });
});

describe('the cold load (mock 2)', () => {
  test('the feed cold load walks: drawing line plus the area copy', async () => {
    gpsLive();
    mockUseHistory.mockReturnValue({ state: { status: 'loading' }, refresh: jest.fn() });
    const screen = await render(<StoriesScreen />);
    expect(await screen.findByText('Finding the stories of Greenwich…')).toBeOnTheScreen();
    expect(
      screen.getByTestId('wander-line-drawing', { includeHiddenElements: true })
    ).toBeOnTheScreen();
  });

  test('reduced motion keeps the copy but stills the line', async () => {
    gpsLive();
    mockUseReducedMotion.mockReturnValue(true);
    mockUseHistory.mockReturnValue({ state: { status: 'loading' }, refresh: jest.fn() });
    const screen = await render(<StoriesScreen />);
    expect(await screen.findByText('Finding the stories of Greenwich…')).toBeOnTheScreen();
    expect(screen.queryByTestId('wander-line-drawing', { includeHiddenElements: true })).toBeNull();
    expect(screen.getByTestId('wander-line', { includeHiddenElements: true })).toBeOnTheScreen();
  });
});

describe('the standing-on banner goes warm (mock 3)', () => {
  test('warm border and ground, warm-ink eyebrow — shape and copy unchanged', async () => {
    const item = story({ pageId: 3, title: 'Greenwich Foot Tunnel' });
    const screen = await render(<StandingOnIt item={item} center={greenwich} />);
    const eyebrow = screen.getByText("You're standing on it");
    expect(eyebrow).toBeOnTheScreen();
    // Light scheme (the test default): warm border, warm-soft ground,
    // and the eyebrow in the warm's dark ink — accentWarm on warmSoft
    // would be yellow-on-yellow
    expect(screen.getByText('Greenwich Foot Tunnel').parent).toBeTruthy();
    expect(eyebrow).toHaveStyle({ color: '#2B1F07' });
    expect(screen.root).toHaveStyle({
      borderColor: Colors.light.accentWarm,
      backgroundColor: Colors.light.warmSoft,
    });
  });
});

describe('the #208 fix: no standing-on claim without a real fix', () => {
  const onTheFallback = story({
    pageId: 5,
    title: 'Equestrian statue of Charles I',
    coordinates: FallbackCoordinates,
  });

  test('location denied: the fallback center never claims "right here"', async () => {
    gpsDenied();
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [onTheFallback] },
      refresh: jest.fn(),
    });
    const screen = await render(<StoriesScreen />);
    await waitFor(() =>
      expect(
        screen.getByText('Location is off — enable it in Settings, or search a place to explore:')
      ).toBeOnTheScreen()
    );
    expect(screen.queryByText("You're standing on it")).toBeNull();
  });

  test('GPS live on the same spot: the banner rightly shows', async () => {
    gpsLive();
    const onGreenwich = story({ pageId: 6, title: 'Greenwich Foot Tunnel' });
    mockUseHistory.mockReturnValue({
      state: { status: 'ready', items: [onGreenwich] },
      refresh: jest.fn(),
    });
    const screen = await render(<StoriesScreen />);
    expect(await screen.findByText("You're standing on it")).toBeOnTheScreen();
  });
});
