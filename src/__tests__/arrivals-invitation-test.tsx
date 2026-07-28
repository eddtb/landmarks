/**
 * The offer, and what happens when it is taken or turned down.
 * Arrivals ship off — background location is not something to switch
 * on for someone — so this card is the feature's front door, and the
 * ⋯ menu is the way back out.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { ArrivalsInvitation } from '@/components/arrivals-invitation';
import { arrivalsHydrated, setArrivalsForTests, shouldOfferArrivals } from '@/data/arrivals';

// Safe above the imports: the factory only closes over these lazily —
// nothing calls them until a press
const mockEnableArrivals = jest.fn().mockResolvedValue('granted');
const mockDisableArrivals = jest.fn().mockResolvedValue(undefined);

jest.mock('@/data/arrival-geofence', () => ({
  enableArrivals: () => mockEnableArrivals(),
  disableArrivals: () => mockDisableArrivals(),
  syncArrivalRegions: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockEnableArrivals.mockResolvedValue('granted');
  await arrivalsHydrated;
  setArrivalsForTests({ enabled: false });
});

it('offers arrivals while they are off and unasked', async () => {
  const screen = await render(<ArrivalsInvitation />);
  expect(screen.getByTestId('arrivals-invitation')).toBeTruthy();
});

it('says what it does without a glyph standing in for a word', async () => {
  const screen = await render(<ArrivalsInvitation />);
  const card = screen.getByTestId('arrivals-invitation');
  // Edd's standing rule (PR #186): signals are words, never emoji
  expect(JSON.stringify(card)).not.toMatch(/\p{Extended_Pictographic}/u);
});

it('is gone once arrivals are on', async () => {
  setArrivalsForTests({ enabled: true });
  const screen = await render(<ArrivalsInvitation />);
  expect(screen.queryByTestId('arrivals-invitation')).toBeNull();
});

it('turns arrivals on when taken up', async () => {
  const screen = await render(<ArrivalsInvitation />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('arrivals-turn-on'));
  });

  await waitFor(() => expect(mockEnableArrivals).toHaveBeenCalledTimes(1));
});

it('retires the offer when turned down, rather than asking every launch', async () => {
  const screen = await render(<ArrivalsInvitation />);

  fireEvent.press(screen.getByTestId('arrivals-not-now'));

  await waitFor(() => expect(shouldOfferArrivals()).toBe(false));
  expect(screen.queryByTestId('arrivals-invitation')).toBeNull();
  expect(mockEnableArrivals).not.toHaveBeenCalled();
});

it('says what is missing when the permission is refused, and offers Settings', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockEnableArrivals.mockResolvedValue('denied-location');
  const screen = await render(<ArrivalsInvitation />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('arrivals-turn-on'));
  });

  await waitFor(() => expect(alert).toHaveBeenCalled());
  const [title, message, buttons] = alert.mock.calls[0];
  expect(title).toBe('Arrivals are off');
  expect(message).toContain('Always');
  expect(buttons?.map((button) => button.text)).toEqual(['Not now', 'Open Settings']);
});

it('names notifications, not location, when notifications are the refusal', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockEnableArrivals.mockResolvedValue('denied-notifications');
  const screen = await render(<ArrivalsInvitation />);

  await act(async () => {
    fireEvent.press(screen.getByTestId('arrivals-turn-on'));
  });

  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(alert.mock.calls[0][1]).toContain('notifications');
});
