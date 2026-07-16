import { fireEvent, render, screen, userEvent } from '@testing-library/react-native';

import ActivitiesTab from '@/app/(tabs)/activities';
import DrinksTab from '@/app/(tabs)/drinks';
import HistoryTab from '@/app/(tabs)/history';
import LandmarksTab from '@/app/(tabs)/index';
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

const mockFetchNearbyHistory = jest.fn();
jest.mock('@/data/history-client', () => ({
  fetchNearbyHistory: (...args: unknown[]) => mockFetchNearbyHistory(...args),
}));

const mockGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  geocodeAsync: (...args: unknown[]) => mockGeocodeAsync(...args),
  reverseGeocodeAsync: jest.fn(async () => [{ district: 'Deptford' }]),
  watchHeadingAsync: jest.fn(async () => ({ remove: jest.fn() })),
}));

function locationState(status: LocationStatus, coordinates: object | null = null) {
  mockUseLocation.mockReturnValue({ status, coordinates, requestPermission: jest.fn() });
}

// Near Tower Bridge, so it sorts first in the landmark section
const NearTowerBridge = { latitude: 51.5055, longitude: -0.0754 };

describe('section tab screens', () => {
  beforeEach(() => {
    mockFetchNearbyPlaces.mockReset();
    mockFetchNearbyPlaces.mockImplementation(async (category: PlaceCategory, center) =>
      placesByCategory(category, center)
    );
    mockFetchNearbyHistory.mockReset();
    mockFetchNearbyHistory.mockResolvedValue([
      {
        pageId: 42,
        title: 'Borough Compter',
        coordinates: { latitude: 51.5045, longitude: -0.0905 },
        distanceMeters: 112,
        url: 'https://en.wikipedia.org/wiki/Borough_Compter',
      },
    ]);
  });

  test('the Landmarks tab shows landmarks with the area header', async () => {
    locationState('ready', NearTowerBridge);
    await render(<LandmarksTab />);

    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    expect(await screen.findByText('Deptford')).toBeOnTheScreen();
    expect(await screen.findByText('Tower Bridge')).toBeOnTheScreen();
    expect(screen.queryByText('The George Inn')).not.toBeOnTheScreen();
    expect(mockFetchNearbyPlaces).toHaveBeenCalledWith('landmark', NearTowerBridge);
  });

  test('the Drinks tab shows drink venues', async () => {
    locationState('ready', NearTowerBridge);
    await render(<DrinksTab />);

    expect(await screen.findByText('The George Inn')).toBeOnTheScreen();
    expect(screen.queryByText('Tower Bridge')).not.toBeOnTheScreen();
    expect(mockFetchNearbyPlaces).toHaveBeenCalledWith('drink', NearTowerBridge);
  });

  test('the Activities tab shows activity venues', async () => {
    locationState('ready', NearTowerBridge);
    await render(<ActivitiesTab />);

    expect(await screen.findByText('Southbank Snooker & Pool Club')).toBeOnTheScreen();
  });

  test('the History tab shows nearby Wikipedia articles', async () => {
    locationState('ready', NearTowerBridge);
    await render(<HistoryTab />);

    expect(await screen.findByText('Borough Compter')).toBeOnTheScreen();
    expect(screen.getByText(/History · 112 m/)).toBeOnTheScreen();
    expect(screen.getByText('From Wikipedia, near your location')).toBeOnTheScreen();
  });

  test('the All | Open control filters closed places, keeping unknowns', async () => {
    locationState('ready', NearTowerBridge);
    await render(<DrinksTab />);
    await screen.findByText('The George Inn');
    // The Anchor is closed in mock data; the Market Porter has no hours
    expect(screen.getByText('The Anchor Bankside')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Open'));

    expect(screen.queryByText('The Anchor Bankside')).not.toBeOnTheScreen();
    expect(screen.getByText('The Market Porter')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('All'));
    expect(await screen.findByText('The Anchor Bankside')).toBeOnTheScreen();
  });

  test('the count-line sort menu reorders by prominence for Featured', async () => {
    locationState('ready', NearTowerBridge);
    // Google featured The Anchor despite it being the longest walk
    mockFetchNearbyPlaces.mockImplementation(async (category: PlaceCategory, center) =>
      placesByCategory(category, center).map((place) => ({
        ...place,
        prominenceRank: place.name === 'The Anchor Bankside' ? 0 : undefined,
      }))
    );
    await render(<DrinksTab />);
    await screen.findByText('The George Inn');

    const names = () =>
      screen
        .getAllByText(/The George Inn|The Anchor Bankside|The Market Porter/)
        .map((node) => node.props.children);
    expect(names()).toEqual(['The George Inn', 'The Market Porter', 'The Anchor Bankside']);
    expect(screen.getByText(/Nearest ▾/)).toBeOnTheScreen();

    // The anchored menu is native chrome; select Featured via its event
    await fireEvent(screen.getByTestId('sort-menu'), 'pressAction', {
      nativeEvent: { event: 'featured' },
    });

    expect(screen.getByText(/Featured ▾/)).toBeOnTheScreen();
    // The featured place leads; unranked places keep their distance order
    expect(names()).toEqual(['The Anchor Bankside', 'The George Inn', 'The Market Porter']);
  });

  test('shows the priming screen before permission is requested', async () => {
    locationState('priming');
    await render(<LandmarksTab />);

    expect(screen.getByText('Enable location')).toBeOnTheScreen();
  });

  test('shows a loading state while locating', async () => {
    locationState('locating');
    await render(<LandmarksTab />);

    expect(screen.getByText('Finding places near you…')).toBeOnTheScreen();
  });

  test('falls back to central London with a search option when denied', async () => {
    locationState('denied');
    await render(<LandmarksTab />);

    expect(screen.getByText(/Location is off — enable it in Settings/)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText('Search near a place…')).toBeOnTheScreen();
    expect(await screen.findByText('Tate Modern')).toBeOnTheScreen();
  });

  test('denied + manual search recenters via free geocoding', async () => {
    jest.useFakeTimers();
    locationState('denied');
    // "Tower Bridge" typed -> geocoder returns its coordinates
    mockGeocodeAsync.mockResolvedValue([{ latitude: 51.5055, longitude: -0.0754 }]);
    await render(<LandmarksTab />);
    await screen.findByText('Tate Modern');

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Search near a place…'), 'Tower Bridge', {
      submitEditing: true,
    });

    expect(mockGeocodeAsync).toHaveBeenCalledWith('Tower Bridge');
    // Places were refetched around the searched position
    await screen.findByText('Tower Bridge');
    expect(mockFetchNearbyPlaces).toHaveBeenLastCalledWith('landmark', {
      latitude: 51.5055,
      longitude: -0.0754,
    });
    jest.useRealTimers();
  });

  test('shows an error state with retry when the API fails', async () => {
    locationState('ready', NearTowerBridge);
    mockFetchNearbyPlaces.mockRejectedValue(new Error('boom'));
    await render(<LandmarksTab />);

    expect(await screen.findByText(/Couldn't load places right now/)).toBeOnTheScreen();
    expect(screen.getByText('Try again')).toBeOnTheScreen();
  });
});
