import { fireEvent, render, screen } from '@testing-library/react-native';

import PlanTab from '@/app/(tabs)/plan';
import { addToPlan, clearPlan, PlanItem } from '@/data/plan-store';

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

const yak: PlanItem = {
  id: 'yak-1',
  kind: 'place',
  name: 'Little Yak',
  photoUrl: 'https://example.com/yak.jpg',
  primaryLabel: 'Restaurant',
  coordinates: { latitude: 51.4823, longitude: -0.0091 },
  rating: 4.9,
  facts: ['Restaurant', '★ 4.9'],
  dwellMinutes: 90,
};

const SuggestionPlan = {
  title: 'x',
  duration: 'hour',
  company: 'solo',
  start: '',
  end: '',
  totalWalkSeconds: 0,
  legs: [{ seconds: 300, meters: 400 }],
  stops: [
    {
      placeId: 'tavern-1',
      name: 'Trafalgar Tavern',
      slotKind: 'drink',
      primaryLabel: 'Pub',
      photoUrl: 'https://example.com/tavern.jpg',
      rating: 4.5,
      coordinates: { latitude: 51.4838, longitude: -0.0037 },
      arrive: '',
      depart: '',
      why: 'A pint where Dickens ate.',
      facts: ['★ 4.5'],
      alternates: [],
    },
  ],
};

describe('<PlanScreen /> anchor-first', () => {
  beforeEach(() => {
    clearPlan();
    mockUseLocation.mockReturnValue({
      status: 'ready',
      coordinates: { latitude: 51.4826, longitude: -0.0077 },
      requestPermission: jest.fn(),
    });
    mockFetchPlan.mockReset();
    mockFetchPlan.mockResolvedValue(SuggestionPlan);
  });

  test('empty state invites ＋Plan and offers the seed button', async () => {
    await render(<PlanTab />);
    expect(screen.getByText('Nothing planned yet')).toBeOnTheScreen();
    expect(screen.getByText('Suggest a first stop')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Suggest a first stop'));
    expect(await screen.findByText('Trafalgar Tavern')).toBeOnTheScreen();
    expect(screen.getByText('A pint where Dickens ate.')).toBeOnTheScreen();

    // Accepting a door anchors the plan
    await fireEvent.press(screen.getByText('Trafalgar Tavern'));
    expect(await screen.findByText('Tonight')).toBeOnTheScreen();
  });

  test('an anchored plan shows the timeline, rail, and clear', async () => {
    addToPlan(yak);
    await render(<PlanTab />);

    expect(await screen.findByText('Tonight')).toBeOnTheScreen();
    expect(screen.getByText('Little Yak')).toBeOnTheScreen();
    expect(screen.getByText(/1 stop ·/)).toBeOnTheScreen();
    expect(screen.getByText('After this?')).toBeOnTheScreen();
    // The rail suggests from the last stop
    expect(await screen.findByText('Trafalgar Tavern')).toBeOnTheScreen();

    // Accepting appends and re-suggests
    await fireEvent.press(screen.getByText('Trafalgar Tavern'));
    expect(screen.getByText(/2 stops ·/)).toBeOnTheScreen();

    // Remove returns to one stop
    await fireEvent.press(screen.getByLabelText('Remove Trafalgar Tavern'));
    expect(screen.getByText(/1 stop ·/)).toBeOnTheScreen();
  });
});
