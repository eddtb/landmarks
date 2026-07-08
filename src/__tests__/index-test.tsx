import { fireEvent, render, screen } from '@testing-library/react-native';

import BrowseScreen from '@/app/index';
import { LocationStatus } from '@/hooks/use-location';

const mockUseLocation = jest.fn();

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

function locationState(status: LocationStatus, coordinates: object | null = null) {
  mockUseLocation.mockReturnValue({ status, coordinates, requestPermission: jest.fn() });
}

// Near Tower Bridge, so it sorts first in the landmark section
const NearTowerBridge = { latitude: 51.5055, longitude: -0.0754 };

describe('<BrowseScreen />', () => {
  test('shows landmarks by default when location is ready', async () => {
    locationState('ready', NearTowerBridge);
    await render(<BrowseScreen />);

    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    expect(screen.queryByText('The George Inn')).not.toBeOnTheScreen();
  });

  test('switching section shows that category', async () => {
    locationState('ready', NearTowerBridge);
    await render(<BrowseScreen />);

    fireEvent.press(screen.getByText('Pubs'));

    expect(await screen.findByText('The George Inn')).toBeOnTheScreen();
    expect(screen.queryByText('Tower Bridge')).not.toBeOnTheScreen();
  });

  test('shows the priming screen before permission is requested', async () => {
    locationState('priming');
    await render(<BrowseScreen />);

    expect(screen.getByText('Enable location')).toBeOnTheScreen();
    expect(screen.queryByText('Tower Bridge')).not.toBeOnTheScreen();
  });

  test('shows a loading state while locating', async () => {
    locationState('locating');
    await render(<BrowseScreen />);

    expect(screen.getByText('Finding places near you…')).toBeOnTheScreen();
  });

  test('falls back to central London with a notice when denied', async () => {
    locationState('denied');
    await render(<BrowseScreen />);

    expect(screen.getByText(/Location is off — showing central London/)).toBeOnTheScreen();
    // List still renders, using the fallback position
    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
  });
});
