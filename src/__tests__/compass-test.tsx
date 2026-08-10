import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Compass } from '@/components/compass';
import { PointerDial } from '@/components/pointer-dial';
import { SlowFixMs } from '@/hooks/use-location';

const mockUseLocation = jest.fn();
const mockUseHeading = jest.fn();
const mockRequestPermission = jest.fn();

// useSlowFix stays REAL — the floor under 'locating' is the thing
// being tested, and a mocked timer would only test the mock
jest.mock('@/hooks/use-location', () => ({
  ...jest.requireActual('@/hooks/use-location'),
  useLocation: () => mockUseLocation(),
  requestLocationPermission: () => mockRequestPermission(),
}));
jest.mock('@/hooks/use-heading', () => ({
  // The dial reads degrees off a SharedValue and branches on
  // availability — the mock keeps the old number|null contract
  useHeadingValue: () => {
    const degrees = mockUseHeading() as number | null;
    return { heading: { value: degrees ?? 0 }, available: degrees !== null };
  },
}));

// ~96m north of the user position below
const Target = { latitude: 51.50636, longitude: -0.0906 };
const User = { latitude: 51.5055, longitude: -0.0906 };

describe('<Compass />', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({ coordinates: User });
    mockUseHeading.mockReturnValue(0);
  });

  test('shows the live distance, and the bearing as a compass point', async () => {
    await render(<Compass target={Target} />);

    expect(screen.getByText('96 m')).toBeOnTheScreen();
    // Due north of the user: the direction is spoken, not just pointed
    expect(screen.getByText('away · N')).toBeOnTheScreen();
  });

  test('the instrument dresses the full dial: ticks, cardinals, the coach line', async () => {
    await render(<Compass target={Target} />);

    expect(screen.getByTestId('dial-ticks')).toBeOnTheScreen();
    expect(screen.getByTestId('cardinal-card')).toBeOnTheScreen();
    for (const letter of ['N', 'E', 'S', 'W']) {
      expect(screen.getByText(letter)).toBeOnTheScreen();
    }
    expect(screen.getByText('Turn until the needle sits at the top')).toBeOnTheScreen();
  });

  test('shows the needle when a heading is available', async () => {
    await render(<Compass target={Target} />);

    expect(screen.getByTestId('compass-needle')).toBeOnTheScreen();
  });

  test('hides the needle and the card without a heading (e.g. simulator) but keeps distance', async () => {
    mockUseHeading.mockReturnValue(null);
    await render(<Compass target={Target} />);

    expect(screen.queryByTestId('compass-needle')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cardinal-card')).not.toBeOnTheScreen();
    expect(screen.getByText('96 m')).toBeOnTheScreen();
    expect(screen.getByText('Distance updates as you move')).toBeOnTheScreen();
  });

  test('without a position the dial still stands — the void was the bug', async () => {
    mockUseLocation.mockReturnValue({ status: 'locating', coordinates: null });
    await render(<Compass target={Target} />);

    expect(screen.getByText('Finding you…')).toBeOnTheScreen();
    expect(screen.getByText('Hold on — finding you')).toBeOnTheScreen();
    expect(screen.queryByTestId('compass-needle')).not.toBeOnTheScreen();
  });

  test('refused is not waiting: the dial says so and offers the Settings door', async () => {
    mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null });
    await render(<Compass target={Target} />);

    // No "finding you" lie — nothing here will ever arrive
    expect(screen.getByText('Location off')).toBeOnTheScreen();
    expect(screen.getByText('Venture can’t see where you are')).toBeOnTheScreen();
    expect(screen.getByText('Open Settings')).toBeOnTheScreen();
    expect(screen.queryByText(/finding you/i)).not.toBeOnTheScreen();
    // A control that announces as one, with a target you can hit
    const settings = screen.getByTestId('open-settings');
    expect(settings).toHaveProp('accessibilityRole', 'button');
    expect(settings).toHaveStyle({ minHeight: 44 });
  });

  test('never asked is not waiting either: the dial says so and offers the ask', async () => {
    // 'priming' — the state "Not now" leaves behind — used to fall
    // through to an unbounded "Finding you…" (#290)
    mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
    await render(<Compass target={Target} />);

    expect(screen.getByText('Not shared')).toBeOnTheScreen();
    expect(screen.getByText('Venture hasn’t asked where you are')).toBeOnTheScreen();
    expect(screen.queryByText(/finding you/i)).not.toBeOnTheScreen();
    // Settings has no Location row to send anyone to yet
    expect(screen.queryByText('Open Settings')).toBeNull();

    await fireEvent.press(screen.getByTestId('ask-for-location'));
    expect(mockRequestPermission).toHaveBeenCalled();
  });

  test('the ask button clears 44pt and never lobbies for the answer', async () => {
    mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
    await render(<Compass target={Target} />);

    const ask = screen.getByTestId('ask-for-location');
    expect(ask).toHaveProp('accessibilityRole', 'button');
    expect(ask).toHaveStyle({ minHeight: 48 });
    // 5.1.1(iv): the label names the mechanism, never the answer
    expect(screen.getByText('Ask for my location')).toBeOnTheScreen();
    expect(screen.queryByText(/allow|enable|turn on/i)).toBeNull();
  });

  test('a granted permission with no fix gets a floor: the wait stops promising', async () => {
    jest.useFakeTimers();
    try {
      mockUseLocation.mockReturnValue({ status: 'locating', coordinates: null });
      await render(<Compass target={Target} />);
      expect(screen.getByText('Finding you…')).toBeOnTheScreen();

      await act(async () => {
        jest.advanceTimersByTime(SlowFixMs);
      });

      expect(screen.getByText('No fix yet')).toBeOnTheScreen();
      expect(screen.getByText('Still looking — indoors this can take a while')).toBeOnTheScreen();
      expect(screen.queryByText('Finding you…')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  test('within arm’s reach the compass stops pointing and says so', async () => {
    // ~8m from the target — under the 15m arrival threshold
    mockUseLocation.mockReturnValue({
      coordinates: { latitude: 51.50629, longitude: -0.0906 },
    });
    await render(<Compass target={Target} />);

    expect(screen.getByText('You’re here — look around')).toBeOnTheScreen();
    expect(screen.getByText('here')).toBeOnTheScreen();
    // The needle still renders — resting at the top, not chasing noise
    expect(screen.getByTestId('compass-needle')).toBeOnTheScreen();
  });
});

describe('<PointerDial compact /> (Go’s sheet dial)', () => {
  test('stays a bare needle-and-number: no ticks, no cardinals, no coach line', async () => {
    mockUseHeading.mockReturnValue(90);
    await render(<PointerDial user={User} target={Target} primary="120 m" compact />);

    expect(screen.getByText('120 m')).toBeOnTheScreen();
    expect(screen.getByTestId('compass-needle')).toBeOnTheScreen();
    expect(screen.queryByTestId('dial-ticks')).not.toBeOnTheScreen();
    expect(screen.queryByTestId('cardinal-card')).not.toBeOnTheScreen();
    expect(screen.queryByText(/Turn until/)).not.toBeOnTheScreen();
  });
});
