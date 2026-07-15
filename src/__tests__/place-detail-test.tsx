import { fireEvent, render, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { Share } from 'react-native';

import PlaceDetailScreen from '@/app/place/[id]/index';
import ReviewsScreen from '@/app/place/[id]/reviews';
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

const mockFetchWhatsOn = jest.fn();
jest.mock('@/data/whats-on-client', () => ({
  fetchWhatsOn: (...args: unknown[]) => mockFetchWhatsOn(...args),
}));

const mockFetchBusyness = jest.fn();
jest.mock('@/data/busyness-client', () => ({
  fetchBusyness: (...args: unknown[]) => mockFetchBusyness(...args),
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
    mockFetchWhatsOn.mockReset();
    mockFetchWhatsOn.mockResolvedValue([]);
    mockFetchBusyness.mockReset();
    mockFetchBusyness.mockResolvedValue(null);
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
    expect(screen.getByText(/12,840/)).toBeOnTheScreen();
  });

  test('shows nothing extra when a place has neither story nor description', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-anchor-bankside' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('The Anchor Bankside')).toBeOnTheScreen();
    expect(screen.queryByText('Story')).not.toBeOnTheScreen();
    expect(screen.queryByText('About')).not.toBeOnTheScreen();
  });

  test("shows What's on events for venues that have them", async () => {
    mockFetchWhatsOn.mockResolvedValue([
      {
        title: 'Quiz night',
        schedule: 'Sundays 8pm',
        detail: '£2 entry',
        sourceUrl: 'https://example.com/quiz',
      },
    ]);
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText("What's on")).toBeOnTheScreen();
    // Every AI-researched claim carries its source
    expect(screen.getByText(/Quiz night · Sundays 8pm · £2 entry/)).toBeOnTheScreen();
    expect(screen.getByText('Source')).toBeOnTheScreen();
  });

  test('Share opens the share sheet with the place name and link', async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<PlaceDetailScreen />);

    await fireEvent.press(screen.getByText('Share'));

    expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining('The George Inn'),
    });
    shareSpy.mockRestore();
  });

  test('shows the busyness forecast as a labelled estimate', async () => {
    const allDay = { morning: 'quiet', afternoon: 'quiet', evening: 'quiet', night: 'quiet' };
    mockFetchBusyness.mockResolvedValue({
      pattern: {
        Monday: allDay,
        Tuesday: allDay,
        Wednesday: allDay,
        Thursday: allDay,
        Friday: allDay,
        Saturday: allDay,
        Sunday: allDay,
      },
      note: 'Fills up on match nights',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'the-george-inn' });
    await render(<PlaceDetailScreen />);

    // Forecast lives in the DETAILS rows, plain grey, labelled estimate
    expect(await screen.findByText('Usually')).toBeOnTheScreen();
    expect(screen.getByText(/quiet around this time · estimate/)).toBeOnTheScreen();
  });

  test('landmarks get no busyness forecast', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    expect(mockFetchBusyness).not.toHaveBeenCalled();
  });

  test('landmarks are not researched for events', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    expect(mockFetchWhatsOn).not.toHaveBeenCalled();
  });

  test('handles unknown ids gracefully', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'narnia' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('This place could not be found.')).toBeOnTheScreen();
  });

  test('reviews on the venue screen are a summary plus one link deeper', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      reviewSummary: 'People say this board game cafe has a huge games library.',
      reviews: [{ author: 'Ada L.', rating: 5, text: 'Splendid views.', when: '2 months ago' }],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    expect(await screen.findByText('Reviews')).toBeOnTheScreen();
    expect(screen.getByText(/board game cafe has a huge games library/)).toBeOnTheScreen();
    expect(screen.getByText(/Summarised with Gemini/)).toBeOnTheScreen();
    expect(screen.getByText('All reviews ›')).toBeOnTheScreen();
    // The comments themselves live one screen deeper
    expect(screen.queryByText('Splendid views.')).not.toBeOnTheScreen();
  });

  test('the reviews screen shows the full comments', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      reviewSummary: 'People say this board game cafe has a huge games library.',
      reviews: [
        { author: 'Ada L.', rating: 5, text: 'Splendid views.', when: '2 months ago' },
        { author: 'Brunel Jr.', rating: 4, text: 'Solid Victorian engineering.' },
      ],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<ReviewsScreen />);

    expect(await screen.findByText('Splendid views.')).toBeOnTheScreen();
    expect(screen.getByText(/Ada L\. · 2 months ago/)).toBeOnTheScreen();
    expect(screen.getByText('Solid Victorian engineering.')).toBeOnTheScreen();
  });

  test('shows kitchen hours with open state when a venue reports them', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      weekdayHours: [
        'Monday: 11:00 AM – 11:00 PM',
        'Tuesday: 11:00 AM – 11:00 PM',
        'Wednesday: 11:00 AM – 11:00 PM',
        'Thursday: 11:00 AM – 11:00 PM',
        'Friday: 11:00 AM – 11:00 PM',
        'Saturday: 11:00 AM – 11:00 PM',
        'Sunday: 11:00 AM – 10:30 PM',
      ],
      kitchenOpenNow: true,
      kitchenWeekdayHours: [
        'Monday: 12:00 – 9:00 PM',
        'Tuesday: 12:00 – 9:00 PM',
        'Wednesday: 12:00 – 9:00 PM',
        'Thursday: 12:00 – 9:00 PM',
        'Friday: 12:00 – 9:00 PM',
        'Saturday: 12:00 – 9:00 PM',
        'Sunday: 12:00 – 8:00 PM',
      ],
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    // Kitchen hours live inside the expanded All hours block
    await fireEvent.press(await screen.findByText('All hours'));
    expect(await screen.findByText(/Kitchen today:/)).toBeOnTheScreen();
  });

  test('omits the reviews section when details have none', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    expect(screen.queryByText('All reviews ›')).not.toBeOnTheScreen();
  });

  test('cold deep link renders from fetched details without a cached summary', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      id: 'cold-start-place',
      name: 'The Mayflower',
      category: 'drink',
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

  test('the Go button leads the actions', async () => {
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    // The journey is a mode, not a section — one violet button opens it
    expect(screen.getByText(/^Go/)).toBeOnTheScreen();
    expect(screen.queryByText('Directions')).not.toBeOnTheScreen();
  });

  test("Share prefers Google's mapsUri once details load", async () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      mapsUri: 'https://maps.google.com/?cid=123',
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    await fireEvent.press(screen.getByText('Share'));

    expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining('https://maps.google.com/?cid=123'),
    });
    shareSpy.mockRestore();
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

  test('weekday hours stay behind the All hours toggle', async () => {
    mockFetchPlaceDetails.mockResolvedValue({
      ...MockPlaces[0],
      id: 'tower-bridge',
      photoUrls: [MockPlaces[0].photoUrl],
      weekdayHours,
    });
    mockUseLocalSearchParams.mockReturnValue({ id: 'tower-bridge' });
    await render(<PlaceDetailScreen />);

    await screen.findByText('Tower Bridge');
    // Collapsed: the DETAILS row shows no weekday lines at all
    expect(weekdayHours.filter((line) => screen.queryByText(line))).toHaveLength(0);

    await fireEvent.press(await screen.findByText('All hours'));

    // Expanded: all seven days are shown
    weekdayHours.forEach((line) => {
      expect(screen.getByText(line)).toBeOnTheScreen();
    });

    await fireEvent.press(screen.getByText('Hide'));
    expect(weekdayHours.filter((line) => screen.queryByText(line))).toHaveLength(0);
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
