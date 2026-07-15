import { render, screen } from '@testing-library/react-native';

import { Compass } from '@/components/compass';

const mockUseLocation = jest.fn();
const mockUseHeading = jest.fn();

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));
jest.mock('@/hooks/use-heading', () => ({
  useHeading: () => mockUseHeading(),
}));

// ~96m north of the user position below
const Target = { latitude: 51.50636, longitude: -0.0906 };
const User = { latitude: 51.5055, longitude: -0.0906 };

describe('<Compass />', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({ coordinates: User });
    mockUseHeading.mockReturnValue(0);
  });

  test('shows the live distance to the target', async () => {
    await render(<Compass target={Target} />);

    expect(screen.getByText('96 m')).toBeOnTheScreen();
    expect(screen.getByText('away')).toBeOnTheScreen();
  });

  test('shows the needle when a heading is available', async () => {
    await render(<Compass target={Target} />);

    expect(screen.getByTestId('compass-needle')).toBeOnTheScreen();
  });

  test('hides the needle without a heading (e.g. simulator) but keeps distance', async () => {
    mockUseHeading.mockReturnValue(null);
    await render(<Compass target={Target} />);

    expect(screen.queryByTestId('compass-needle')).not.toBeOnTheScreen();
    expect(screen.getByText('96 m')).toBeOnTheScreen();
    expect(screen.getByText('Distance updates as you move')).toBeOnTheScreen();
  });

  test('renders nothing at all without a position', async () => {
    mockUseLocation.mockReturnValue({ coordinates: null });
    await render(<Compass target={Target} />);

    expect(screen.queryByText('away')).not.toBeOnTheScreen();
  });
});
