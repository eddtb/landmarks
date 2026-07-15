import { fireEvent, render, screen } from '@testing-library/react-native';

import { NavigationSection } from '@/components/navigation-section';

const mockUseLocation = jest.fn();
const mockUseHeading = jest.fn();
const mockFetchWalkingRoute = jest.fn();

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));
jest.mock('@/hooks/use-heading', () => ({
  useHeading: () => mockUseHeading(),
}));
jest.mock('@/data/route-client', () => ({
  fetchWalkingRoute: (...args: unknown[]) => mockFetchWalkingRoute(...args),
}));

const User = { latitude: 51.5055, longitude: -0.0906 };
const Target = { latitude: 51.5045, longitude: -0.0865 };

describe('<NavigationSection />', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({ coordinates: User });
    mockUseHeading.mockReturnValue(null);
    mockFetchWalkingRoute.mockReset();
  });

  test('defaults to the compass and fetches no route', async () => {
    await render(<NavigationSection target={Target} />);

    expect(screen.getByText('away')).toBeOnTheScreen();
    expect(mockFetchWalkingRoute).not.toHaveBeenCalled();
  });

  test('switching to Route fetches lazily and lists the steps', async () => {
    mockFetchWalkingRoute.mockResolvedValue({
      seconds: 302,
      meters: 344,
      steps: [
        { instruction: 'Head east on Middle Rd', meters: 22 },
        { instruction: 'Turn right onto St Thomas St', meters: 201 },
      ],
    });
    await render(<NavigationSection target={Target} />);

    fireEvent.press(screen.getByText('Route'));

    expect(await screen.findByText(/5 min walk · 344 m/)).toBeOnTheScreen();
    expect(screen.getByText('Head east on Middle Rd')).toBeOnTheScreen();
    expect(screen.getByText('Turn right onto St Thomas St')).toBeOnTheScreen();
    expect(mockFetchWalkingRoute).toHaveBeenCalledWith(User, Target);
  });

  test('route unavailable shows a friendly message', async () => {
    mockFetchWalkingRoute.mockResolvedValue(null);
    await render(<NavigationSection target={Target} />);

    fireEvent.press(screen.getByText('Route'));

    expect(await screen.findByText('No walking route available.')).toBeOnTheScreen();
  });

  test('switching back to Compass restores the dial', async () => {
    mockFetchWalkingRoute.mockResolvedValue(null);
    await render(<NavigationSection target={Target} />);

    fireEvent.press(screen.getByText('Route'));
    await screen.findByText('No walking route available.');
    fireEvent.press(screen.getByText('Compass'));

    expect(await screen.findByText('away')).toBeOnTheScreen();
  });
});
