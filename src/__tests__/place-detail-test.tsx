import { render, screen } from '@testing-library/react-native';

import PlaceDetailScreen from '@/app/place/[id]';
import { MockPlaces } from '@/data/mock-places';
import { cachePlaces } from '@/data/places-client';

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    // Stack.Screen only sets the native header title; render nothing in tests
    Stack: { Screen: () => null },
  };
});

jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));

describe('<PlaceDetailScreen />', () => {
  beforeAll(() => {
    // Simulate places fetched earlier by the browse screen
    cachePlaces(MockPlaces);
  });

  test('shows place facts and the Story section for a landmark', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    expect(screen.getByText('Tower Bridge Rd, London SE1 2UP')).toBeOnTheScreen();
    expect(screen.getByText('Story')).toBeOnTheScreen();
    expect(screen.getByText(/bascule and suspension bridge/)).toBeOnTheScreen();
  });

  test('omits the Story section when a place has none', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'padella' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Padella')).toBeOnTheScreen();
    expect(screen.queryByText('Story')).not.toBeOnTheScreen();
  });

  test('handles unknown ids gracefully', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'narnia' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('This place could not be found.')).toBeOnTheScreen();
  });
});
