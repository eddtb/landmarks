import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';

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

// The detail screens render a Compass, which needs these hooks
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => ({ coordinates: { latitude: 51.5055, longitude: -0.0906 } }),
}));
jest.mock('@/hooks/use-heading', () => ({
  useHeading: () => null,
}));



jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

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
    jest.mocked(Linking.openURL).mockReset();
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

  test('renders reviews when details include them', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      reviews: [
        { author: 'Ada L.', rating: 5, text: 'Splendid views.', when: '2 months ago' },
        { author: 'Brunel Jr.', rating: 4, text: 'Solid Victorian engineering.' },
      ],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('What people say')).toBeOnTheScreen();
    expect(screen.getByText('Splendid views.')).toBeOnTheScreen();
    expect(screen.getByText(/Ada L\. · 2 months ago/)).toBeOnTheScreen();
    expect(screen.getByText('Solid Victorian engineering.')).toBeOnTheScreen();
  });

  test('shows the Gemini review summary with disclosure when present', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      reviewSummary: 'People say this board game cafe has a huge games library.',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText(/board game cafe has a huge games library/)).toBeOnTheScreen();
    expect(screen.getByText('Summarized with Gemini')).toBeOnTheScreen();
  });

  test('omits the reviews section when details have none', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    expect(screen.queryByText('What people say')).not.toBeOnTheScreen();
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

  test('opens the maps app with the place coordinates when Directions is pressed', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    fireEvent.press(screen.getByText('Directions'));

    expect(Linking.openURL).toHaveBeenCalledTimes(1);
    const url = jest.mocked(Linking.openURL).mock.calls[0][0];
    expect(url).toContain('51.5055');
    expect(url).toContain('-0.0754');
  });

  test("prefers Google's mapsUri for Directions once details load", async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      mapsUri: 'https://maps.google.com/?cid=123',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    fireEvent.press(screen.getByText('Directions'));

    expect(Linking.openURL).toHaveBeenCalledWith('https://maps.google.com/?cid=123');
  });

  test('hides Call when the place has no phone number', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(screen.queryByText('Call')).not.toBeOnTheScreen();
  });

  test('dials the place phone number once details with a phone load', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      phone: '020 7407 1002',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    fireEvent.press(await screen.findByText('Call'));

    expect(Linking.openURL).toHaveBeenCalledWith('tel:020 7407 1002');
  });

  test('shows the price level in the meta line once details load', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      priceLevel: '££',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText(/· ££$/)).toBeOnTheScreen();
  });

  test('shows no price level when details lack one', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    expect(screen.queryByText(/£/)).not.toBeOnTheScreen();
  });

  const weekdayHours = [
    'Monday: 9:00 AM – 6:00 PM',
    'Tuesday: 9:00 AM – 6:00 PM',
    'Wednesday: 9:00 AM – 6:00 PM',
    'Thursday: 9:00 AM – 6:00 PM',
    'Friday: 9:00 AM – 6:00 PM',
    'Saturday: 10:00 AM – 4:00 PM',
    'Sunday: Closed',
  ];

  test("shows only today's hours until expanded, then all seven days", async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      weekdayHours,
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    // Plain hours line stays visible alongside the collapsed weekday row
    expect(screen.getByText('Open 09:30 – 18:00')).toBeOnTheScreen();

    // Collapsed: exactly one weekday line is shown (today's, whichever day that is)
    const collapsedLine = weekdayHours.find((line) => screen.queryByText(line));
    expect(collapsedLine).toBeDefined();
    expect(weekdayHours.filter((line) => screen.queryByText(line))).toHaveLength(1);

    await fireEvent.press(screen.getByText(collapsedLine as string));

    // Expanded: all seven days are shown
    weekdayHours.forEach((line) => {
      expect(screen.getByText(line)).toBeOnTheScreen();
    });
  });

  test('shows no weekday hours row when details lack it', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    weekdayHours.forEach((line) => {
      expect(screen.queryByText(line)).not.toBeOnTheScreen();
    });
  });
});
