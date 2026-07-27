import { render, screen } from '@testing-library/react-native';

import { Compass } from '@/components/compass';
import { PointerDial } from '@/components/pointer-dial';

const mockUseLocation = jest.fn();
const mockUseHeading = jest.fn();

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
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

  test('denied is not waiting: the dial says so and offers the Settings door', async () => {
    mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null });
    await render(<Compass target={Target} />);

    // No "finding you" lie — nothing here will ever arrive
    expect(screen.getByText('Location off')).toBeOnTheScreen();
    expect(screen.getByText('Venture can’t see where you are')).toBeOnTheScreen();
    expect(screen.getByText('Enable location in Settings')).toBeOnTheScreen();
    expect(screen.queryByText(/finding you/i)).not.toBeOnTheScreen();
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
