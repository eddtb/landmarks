import { fireEvent, render, screen } from '@testing-library/react-native';

import BrowseScreen from '@/app/index';
import { placesByCategory } from '@/data/mock-places';
import { LocationStatus } from '@/hooks/use-location';
import { PlaceCategory } from '@/types/place';
import { Coordinates } from '@/utils/geo';

const mockUseLocation = jest.fn();
const mockFetchNearbyPlaces = jest.fn();

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/data/places-client', () => ({
  fetchNearbyPlaces: (category: PlaceCategory, center: Coordinates) =>
    mockFetchNearbyPlaces(category, center),
  getCachedPlace: jest.fn(),
}));

function locationState(status: LocationStatus, coordinates: object | null = null) {
  mockUseLocation.mockReturnValue({ status, coordinates, requestPermission: jest.fn() });
}

// Near Tower Bridge, so it sorts first in the landmark section
const NearTowerBridge = { latitude: 51.5055, longitude: -0.0754 };

describe('<BrowseScreen />', () => {
  beforeEach(() => {
    mockFetchNearbyPlaces.mockReset();
    mockFetchNearbyPlaces.mockImplementation(async (category: PlaceCategory, center) => ({
      places: placesByCategory(category, center),
    }));
  });

  test('shows landmarks from the API when location is ready', async () => {
    locationState('ready', NearTowerBridge);
    await render(<BrowseScreen />);

    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(await screen.findByText('Tower Bridge')).toBeOnTheScreen();
    expect(screen.queryByText('The George Inn')).not.toBeOnTheScreen();
    expect(mockFetchNearbyPlaces).toHaveBeenCalledWith('landmark', NearTowerBridge);
  });

  test('switching section fetches and shows that category', async () => {
    locationState('ready', NearTowerBridge);
    await render(<BrowseScreen />);
    await screen.findByText('Tower Bridge');

    fireEvent.press(screen.getByText('Pubs'));

    expect(await screen.findByText('The George Inn')).toBeOnTheScreen();
    expect(screen.queryByText('Tower Bridge')).not.toBeOnTheScreen();
  });

  test('shows the priming screen before permission is requested', async () => {
    locationState('priming');
    await render(<BrowseScreen />);

    expect(screen.getByText('Enable location')).toBeOnTheScreen();
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
    expect(await screen.findByText('Tate Modern')).toBeOnTheScreen();
  });

  test('shows an error state with retry when the API fails', async () => {
    locationState('ready', NearTowerBridge);
    mockFetchNearbyPlaces.mockRejectedValue(new Error('boom'));
    await render(<BrowseScreen />);

    expect(await screen.findByText(/Couldn't load places right now/)).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });
});
