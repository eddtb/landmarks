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

const mockFetchStory = jest.fn();
jest.mock('@/data/story-client', () => ({
  fetchStory: (...args: unknown[]) => mockFetchStory(...args),
}));

// Two-tier fetch: keep the real summary cache, mock only the details call
const mockFetchPlaceDetails = jest.fn();
jest.mock('@/data/places-client', () => {
  const actual = jest.requireActual('@/data/places-client');
  return {
    ...actual,
    fetchPlaceDetails: (...args: unknown[]) => mockFetchPlaceDetails(...args),
  };
});

describe('<PlaceDetailScreen />', () => {
  beforeAll(() => {
    // Simulate places fetched earlier by the browse screen
    cachePlaces(MockPlaces);
  });

  beforeEach(() => {
    mockFetchStory.mockReset();
    mockFetchStory.mockResolvedValue(null);
    mockFetchPlaceDetails.mockReset();
    // Default: details lookup finds nothing extra; screens render from summary
    mockFetchPlaceDetails.mockResolvedValue(null);
  });

  test('shows place facts and the built-in story for demo places', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    expect(screen.getByText('Tower Bridge Rd, London SE1 2UP')).toBeOnTheScreen();
    expect(screen.getByText('Story')).toBeOnTheScreen();
    expect(screen.getByText(/bascule and suspension bridge/)).toBeOnTheScreen();
    // Built-in story — Wikipedia is not consulted
    expect(mockFetchStory).not.toHaveBeenCalled();
  });

  test('fetches a Wikipedia story for places without one', async () => {
    mockFetchStory.mockResolvedValue({
      story: 'Padella is famous for its pasta.',
      title: 'Padella',
      url: 'https://en.wikipedia.org/wiki/Padella',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'padella' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('Story')).toBeOnTheScreen();
    expect(screen.getByText('Padella is famous for its pasta.')).toBeOnTheScreen();
    expect(screen.getByText('From Wikipedia')).toBeOnTheScreen();
  });

  test("falls back to Google's About text when no article matches", async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'padella' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Padella')).toBeOnTheScreen();
    expect(screen.queryByText('Story')).not.toBeOnTheScreen();
    expect(await screen.findByText('About')).toBeOnTheScreen();
    expect(screen.getByText(/handmade pasta at counter seats/)).toBeOnTheScreen();
    // Review count joins the meta line
    expect(screen.getByText(/12,840 reviews/)).toBeOnTheScreen();
  });

  test('shows nothing extra when a place has neither story nor description', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-anchor-bankside' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('The Anchor Bankside')).toBeOnTheScreen();
    expect(screen.queryByText('Story')).not.toBeOnTheScreen();
    expect(screen.queryByText('About')).not.toBeOnTheScreen();
  });

  test('handles unknown ids gracefully', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'narnia' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('This place could not be found.')).toBeOnTheScreen();
  });

  test('cold deep link renders from fetched details without a cached summary', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      id: 'cold-start-place',
      name: 'The Mayflower',
      category: 'pub',
      coordinates: { latitude: 51.5015, longitude: -0.0536 },
      rating: 4.5,
      ratingCount: 3200,
      photoUrl: 'https://example.com/photo.jpg',
      photoUrls: ['https://example.com/photo.jpg'],
      address: '117 Rotherhithe St, London SE16 4NF',
      hours: 'Open now',
      phone: '020 7237 4088',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'cold-start-place' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('The Mayflower')).toBeOnTheScreen();
    expect(screen.getByText('117 Rotherhithe St, London SE16 4NF')).toBeOnTheScreen();
  });
});
