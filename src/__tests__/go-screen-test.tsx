import { fireEvent, render, screen } from '@testing-library/react-native';

import GoScreen from '@/app/place/[id]/go';
import { MockPlaces } from '@/data/mock-places';
import { cachePlaces } from '@/data/places-client';

const mockUseLocalSearchParams = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    router: { ...actual.router, back: () => mockBack() },
    Stack: { Screen: () => null },
  };
});

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

jest.mock('@/hooks/use-location', () => ({
  useLocation: () => ({ coordinates: { latitude: 51.5055, longitude: -0.0906 } }),
}));
jest.mock('@/hooks/use-heading', () => ({
  useHeading: () => null,
}));

const mockFetchPlaceDetails = jest.fn();
jest.mock('@/data/places-client', () => {
  const actual = jest.requireActual('@/data/places-client');
  return {
    ...actual,
    fetchPlaceDetails: (...args: unknown[]) => mockFetchPlaceDetails(...args),
  };
});

const mockFetchWalkingRoute = jest.fn();
jest.mock('@/data/route-client', () => ({
  fetchWalkingRoute: (...args: unknown[]) => mockFetchWalkingRoute(...args),
}));

describe('<GoScreen />', () => {
  beforeAll(() => {
    cachePlaces(MockPlaces);
  });

  beforeEach(() => {
    mockFetchPlaceDetails.mockReset();
    mockFetchPlaceDetails.mockResolvedValue(null);
    mockFetchWalkingRoute.mockReset();
    mockBack.mockReset();
  });

  test('shows the map with the live instruction sheet when a route exists', async () => {
    mockFetchWalkingRoute.mockResolvedValue({
      seconds: 302,
      meters: 344,
      steps: [
        {
          instruction: 'Head east on Middle Rd',
          meters: 22,
          start: { latitude: 51.5055, longitude: -0.0906 },
          end: { latitude: 51.5055, longitude: -0.0903 },
        },
        {
          instruction: 'Turn right onto Bedale St',
          meters: 79,
          start: { latitude: 51.5055, longitude: -0.0903 },
          end: { latitude: 51.5041, longitude: -0.09 },
        },
      ],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<GoScreen />);

    expect(await screen.findByTestId('route-map')).toBeOnTheScreen();
    expect(screen.getByText('The George Inn')).toBeOnTheScreen();
    expect(screen.getByText(/5 min walk · 344 m/)).toBeOnTheScreen();
    expect(screen.getByText('Head east on Middle Rd')).toBeOnTheScreen();
  });

  test('tapping the sheet reveals every step', async () => {
    mockFetchWalkingRoute.mockResolvedValue({
      seconds: 302,
      meters: 344,
      steps: [
        {
          instruction: 'Head east on Middle Rd',
          meters: 22,
          start: { latitude: 51.5055, longitude: -0.0906 },
          end: { latitude: 51.5055, longitude: -0.0903 },
        },
        {
          instruction: 'Turn right onto Bedale St',
          meters: 79,
          start: { latitude: 51.5055, longitude: -0.0903 },
          end: { latitude: 51.5041, longitude: -0.09 },
        },
      ],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<GoScreen />);
    await screen.findByTestId('route-map');

    await fireEvent.press(screen.getByText('Head east on Middle Rd'));

    expect(await screen.findByText(/2\. Turn right onto Bedale St/)).toBeOnTheScreen();
  });

  test('switching to Compass shows the dial', async () => {
    mockFetchWalkingRoute.mockResolvedValue(null);
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<GoScreen />);

    await fireEvent.press(screen.getByText('Compass'));

    expect(await screen.findByText('away')).toBeOnTheScreen();
  });

  test('no route falls back to the compass with a note', async () => {
    mockFetchWalkingRoute.mockResolvedValue(null);
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<GoScreen />);

    expect(await screen.findByText(/No walking route available/)).toBeOnTheScreen();
    expect(screen.getByText('away')).toBeOnTheScreen();
  });
});
