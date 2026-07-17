import { fireEvent, render, screen } from '@testing-library/react-native';

import PlanTab from '@/app/(tabs)/plan';
import { Plan } from '@/types/plan';

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

const mockFetchPlan = jest.fn();
jest.mock('@/data/plan-client', () => ({
  fetchPlan: (...args: unknown[]) => mockFetchPlan(...args),
}));

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(async () => [{ district: 'Greenwich' }]),
}));

const EveningPlan: Plan = {
  title: 'Golden hour to last orders',
  duration: 'evening',
  company: 'date',
  start: '2026-07-21T17:30:00.000Z',
  end: '2026-07-21T21:30:00.000Z',
  totalWalkSeconds: 1500,
  stops: [
    {
      placeId: 'park-1',
      name: 'Greenwich Park',
      slotKind: 'landmark',
      primaryLabel: 'Park',
      photoUrl: 'https://example.com/park.jpg',
      rating: 4.8,
      coordinates: { latitude: 51.4769, longitude: 0.0005 },
      arrive: '2026-07-21T17:49:00.000Z',
      depart: '2026-07-21T18:34:00.000Z',
      why: 'Catch the river light before dinner.',
      facts: ['★ 4.8'],
      alternates: [
        {
          placeId: 'market-1',
          name: 'Greenwich Market',
          primaryLabel: 'Market',
          photoUrl: 'https://example.com/market.jpg',
          rating: 4.6,
          coordinates: { latitude: 51.481, longitude: -0.009 },
          facts: ['★ 4.6'],
        },
      ],
    },
    {
      placeId: 'yak-1',
      name: 'Little Yak',
      slotKind: 'meal',
      primaryLabel: 'Restaurant',
      photoUrl: 'https://example.com/yak.jpg',
      rating: 4.9,
      priceLevel: '££',
      coordinates: { latitude: 51.4823, longitude: -0.0091 },
      arrive: '2026-07-21T18:47:00.000Z',
      depart: '2026-07-21T20:17:00.000Z',
      why: 'The best-rated kitchen within ten minutes.',
      facts: ['★ 4.9', '££', 'Open till 10pm'],
      alternates: [],
    },
  ],
  legs: [
    { seconds: 1140, meters: 1516 },
    {
      seconds: 780,
      meters: 1037,
      story: { pageId: 7, title: 'Palace of Placentia', hook: 'Henry VIII was born here.' },
    },
  ],
};

describe('<PlanScreen />', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.4826, longitude: -0.0077 },
      requestPermission: jest.fn(),
    });
    mockFetchPlan.mockReset();
    mockFetchPlan.mockResolvedValue(EveningPlan);
  });

  test('asks the two questions with the clock preselecting duration', async () => {
    await render(<PlanTab />);

    expect(screen.getByText('How long?')).toBeOnTheScreen();
    expect(screen.getByText('Who with?')).toBeOnTheScreen();
    expect(screen.getByText('An evening')).toBeOnTheScreen();
    expect(screen.getByText('A date')).toBeOnTheScreen();
    expect(screen.getByText(/Compose the/)).toBeOnTheScreen();
  });

  test('composes and renders the timeline: whys, facts, stories, legs', async () => {
    await render(<PlanTab />);

    await fireEvent.press(screen.getByText('A date'));
    await fireEvent.press(screen.getByText(/Compose the/));

    expect(await screen.findByText('Golden hour to last orders')).toBeOnTheScreen();
    expect(mockFetchPlan).toHaveBeenCalledWith(
      expect.objectContaining({ company: 'date', fresh: false })
    );
    expect(screen.getByText('Greenwich Park')).toBeOnTheScreen();
    expect(screen.getByText('Catch the river light before dinner.')).toBeOnTheScreen();
    expect(screen.getByText(/2 stops · 25 min walking/)).toBeOnTheScreen();
    // The story rides its leg
    expect(screen.getByText('Henry VIII was born here.')).toBeOnTheScreen();
    // Facts read as our voice: label · rating · price
    expect(screen.getByText(/Restaurant · ★ 4.9 · ££/)).toBeOnTheScreen();
  });

  test('swap rotates a stop through its fitted alternates', async () => {
    await render(<PlanTab />);
    await fireEvent.press(screen.getByText(/Compose the/));
    await screen.findByText('Greenwich Park');

    await fireEvent.press(screen.getByText('Swap'));
    expect(screen.getByText('Greenwich Market')).toBeOnTheScreen();
    expect(screen.queryByText('Greenwich Park')).not.toBeOnTheScreen();

    // Another tap wraps back around to the original
    await fireEvent.press(screen.getByText('Swap'));
    expect(screen.getByText('Greenwich Park')).toBeOnTheScreen();
  });

  test('✕ returns to the questions; ↻ recomposes fresh', async () => {
    await render(<PlanTab />);
    await fireEvent.press(screen.getByText(/Compose the/));
    await screen.findByText('Golden hour to last orders');

    await fireEvent.press(screen.getByLabelText('Recompose'));
    expect(mockFetchPlan).toHaveBeenLastCalledWith(expect.objectContaining({ fresh: true }));

    await screen.findByText('Golden hour to last orders');
    await fireEvent.press(screen.getByLabelText('Back to questions'));
    expect(screen.getByText('How long?')).toBeOnTheScreen();
  });

  test('a failed composition says so and lets you retry', async () => {
    mockFetchPlan.mockRejectedValue(new Error('offline'));
    await render(<PlanTab />);
    await fireEvent.press(screen.getByText(/Compose the/));

    expect(await screen.findByText(/Couldn't compose a plan right now/)).toBeOnTheScreen();
    expect(screen.getByText('How long?')).toBeOnTheScreen();
  });
});

describe('<PlanScreen /> build mode', () => {
  beforeEach(() => {
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.4826, longitude: -0.0077 },
      requestPermission: jest.fn(),
    });
    mockFetchPlan.mockReset();
    mockFetchPlan.mockResolvedValue(EveningPlan);
  });

  test('walks the slots as doors; picks carry into the timeline', async () => {
    await render(<PlanTab />);
    await fireEvent.press(screen.getByText(/or build it together/));

    // Step 1: the landmark slot's doors, Venture's pick marked
    expect(await screen.findByText('Building the plan')).toBeOnTheScreen();
    expect(screen.getByText('1 of 2')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich Park')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich Market')).toBeOnTheScreen();

    // Pick the alternate door
    await fireEvent.press(screen.getByText('Greenwich Market'));
    expect(screen.getByText('2 of 2')).toBeOnTheScreen();

    // Last slot has no alternates — one door
    await fireEvent.press(screen.getByText('Little Yak'));

    // The assembled timeline honours the pick
    expect(await screen.findByText('Golden hour to last orders')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich Market')).toBeOnTheScreen();
    expect(screen.queryByText('Greenwich Park')).not.toBeOnTheScreen();
  });
});
