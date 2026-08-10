/**
 * The location-dependent MODALS, with no position (#290). Under a
 * comment reading "never a spinner that can't end", every state but
 * 'denied' fell through to an unbounded "Finding you…" — including
 * 'priming', the state "Not now" leaves behind, and 'locating', which
 * a granted permission can sit in forever indoors.
 *
 * Both modals are fenced from one table: the rule is "no location-
 * dependent screen waits forever", not "Go behaves". A third dip-in
 * tool joins this table or fails it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ReactElement } from 'react';

import CompassScreen from '@/app/history/[pageId]/compass';
import GoScreen from '@/app/history/[pageId]/go';
import { SlowFixMs } from '@/hooks/use-location';
import { HistoryItem } from '@/types/history';

const winchesterPalace: HistoryItem = {
  pageId: 42,
  title: 'Winchester Palace',
  coordinates: { latitude: 51.5075, longitude: -0.089 },
  distanceMeters: 300,
  url: 'https://x',
  source: 'Wikipedia',
};

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ pageId: '42' }),
}));

const mockUseLocation = jest.fn();
const mockRequestPermission = jest.fn();
// useSlowFix stays REAL — the floor is the thing being tested, and a
// mocked timer would only test the mock
jest.mock('@/hooks/use-location', () => ({
  ...jest.requireActual('@/hooks/use-location'),
  useLocation: () => mockUseLocation(),
  requestLocationPermission: () => mockRequestPermission(),
}));

jest.mock('@/hooks/use-heading', () => ({
  useHeadingValue: () => ({ heading: { value: 0 }, available: false }),
}));

jest.mock('@/data/history-client', () => ({
  getCachedHistoryItem: () => winchesterPalace,
}));

jest.mock('@/data/route-client', () => ({
  fetchRoute: jest.fn().mockResolvedValue(null),
}));

/** Every dip-in tool that needs a position to say anything. */
const modals: { name: string; screen: () => ReactElement }[] = [
  { name: 'Go', screen: () => <GoScreen /> },
  { name: 'Compass', screen: () => <CompassScreen /> },
];

beforeEach(() => {
  jest.clearAllMocks();
});

describe('no location-dependent modal waits forever', () => {
  for (const modal of modals) {
    test(`${modal.name}, never asked: says so and offers the ask, never "Finding you…"`, async () => {
      mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
      await render(modal.screen());

      expect(screen.getByText('Venture hasn’t asked where you are')).toBeOnTheScreen();
      expect(screen.queryByText(/finding you/i)).toBeNull();
      // Settings has no Location row to send anyone to yet
      expect(screen.queryByTestId('open-settings')).toBeNull();

      await fireEvent.press(screen.getByTestId('ask-for-location'));
      expect(mockRequestPermission).toHaveBeenCalled();
    });

    test(`${modal.name}, refused: says so and offers Settings, never the ask`, async () => {
      mockUseLocation.mockReturnValue({ status: 'denied', coordinates: null });
      await render(modal.screen());

      expect(screen.getByText('Venture can’t see where you are')).toBeOnTheScreen();
      expect(screen.queryByText(/finding you/i)).toBeNull();
      expect(screen.queryByTestId('ask-for-location')).toBeNull();

      const settings = screen.getByTestId('open-settings');
      expect(settings).toHaveProp('accessibilityRole', 'button');
      expect(settings).toHaveStyle({ minHeight: 44 });
    });

    test(`${modal.name}, granted but no fix: the wait gets a floor and stops promising`, async () => {
      jest.useFakeTimers();
      try {
        mockUseLocation.mockReturnValue({ status: 'locating', coordinates: null });
        await render(modal.screen());
        // The compass says it twice — the dial's number and its coach line
        expect(screen.getAllByText(/finding you/i).length).toBeGreaterThan(0);

        await act(async () => {
          jest.advanceTimersByTime(SlowFixMs);
        });

        expect(screen.queryByText('Finding you…')).toBeNull();
        expect(screen.getByText(/still looking/i)).toBeOnTheScreen();
      } finally {
        jest.useRealTimers();
      }
    });
  }
});

describe('Go’s own copy', () => {
  test('never asked: the story is still readable — the walk is the only casualty', async () => {
    mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
    await render(<GoScreen />);

    expect(screen.getByText('Not shared')).toBeOnTheScreen();
    expect(
      screen.getByText('Walking there needs your position. The story reads fine without it.')
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByText('Read the story instead'));
    expect(mockBack).toHaveBeenCalled();
  });

  test('granted but no fix: the floor carries a way out, not just words', async () => {
    jest.useFakeTimers();
    try {
      mockUseLocation.mockReturnValue({ status: 'locating', coordinates: null });
      await render(<GoScreen />);

      await act(async () => {
        jest.advanceTimersByTime(SlowFixMs);
      });

      expect(screen.getByText('Still looking for you')).toBeOnTheScreen();
      await fireEvent.press(screen.getByText('Read the story instead'));
      expect(mockBack).toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the three no-fix states are three different dials', () => {
  // Collapse never-asked back into refused and these go red: the
  // dial's own number is the tell, and each state is asserted to
  // withhold the other two's.
  const dials = [
    { status: 'priming', reads: 'Not shared', notThese: ['Location off', 'Finding you…'] },
    { status: 'denied', reads: 'Location off', notThese: ['Not shared', 'Finding you…'] },
    { status: 'locating', reads: 'Finding you…', notThese: ['Not shared', 'Location off'] },
  ];

  for (const dial of dials) {
    test(`${dial.status} reads “${dial.reads}” and nothing else’s number`, async () => {
      mockUseLocation.mockReturnValue({ status: dial.status, coordinates: null });
      await render(<CompassScreen />);

      expect(screen.getByText(dial.reads)).toBeOnTheScreen();
      for (const other of dial.notThese) {
        expect(screen.queryByText(other)).toBeNull();
      }
    });
  }
});
