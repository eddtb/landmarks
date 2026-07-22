/**
 * The one door (approved round-2 Option A): the single first-run gate
 * that replaced the three-card onboarding AND the old location-priming
 * screen. These pin its contract — shown only while permission is
 * undetermined, Enable hands off to the system dialog, "Not now" is
 * remembered and falls through to the denied-state UI (banner +
 * search), and a returning dismisser never sees a flash of the door.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ONE_DOOR_DISMISSED_KEY } from '@/components/one-door';
import { StoriesScreen } from '@/components/section-screen';
import { clearPin } from '@/hooks/use-pin';

const mockUseLocation = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
}));

jest.mock('@/hooks/use-area-name', () => ({
  useAreaName: () => 'Greenwich',
}));

jest.mock('expo-location', () => ({
  geocodeAsync: jest.fn().mockResolvedValue([]),
}));

const mockUseHistory = jest.fn();
jest.mock('@/hooks/use-history', () => ({
  useHistory: (...args: unknown[]) => mockUseHistory(...args),
}));

const deniedBanner = 'Location is off — enable it in Settings, or search a place to explore:';

const requestPermission = jest.fn();

/** iOS hasn't been asked yet — the only state where the door shows. */
function permissionUndetermined() {
  mockUseLocation.mockReturnValue({
    status: 'priming',
    coordinates: null,
    requestPermission,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  clearPin();
  mockUseHistory.mockReturnValue({ state: { status: 'ready', items: [] }, refresh: jest.fn() });
});

test('permission undetermined: the door, its copy, and both actions', async () => {
  permissionUndetermined();
  const screen = await render(<StoriesScreen />);

  expect(await screen.findByTestId('one-door')).toBeOnTheScreen();
  expect(screen.getByText('VENTURE')).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: 'The history within a walk of you' })).toBeOnTheScreen();
  expect(screen.getByTestId('one-door-enable')).toBeOnTheScreen();
  expect(screen.getByTestId('one-door-not-now')).toBeOnTheScreen();
  // The door replaces the app — no denied banner behind it
  expect(screen.queryByText(deniedBanner)).toBeNull();
});

test('"Enable location" hands off to requestPermission', async () => {
  permissionUndetermined();
  const screen = await render(<StoriesScreen />);

  fireEvent.press(await screen.findByTestId('one-door-enable'));

  expect(requestPermission).toHaveBeenCalled();
  // The door stays up — it leaves only when the permission status does
  expect(screen.getByTestId('one-door')).toBeOnTheScreen();
});

test('"Not now" persists the flag and falls through to the denied UI', async () => {
  permissionUndetermined();
  const screen = await render(<StoriesScreen />);

  fireEvent.press(await screen.findByTestId('one-door-not-now'));

  await waitFor(() => expect(screen.queryByTestId('one-door')).toBeNull());
  expect(screen.getByText(deniedBanner)).toBeOnTheScreen();
  expect(screen.getByTestId('place-search')).toBeOnTheScreen();
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONE_DOOR_DISMISSED_KEY, 'true');
});

test('a dismissed flag skips the door — straight to the denied UI', async () => {
  await AsyncStorage.setItem(ONE_DOOR_DISMISSED_KEY, 'true');
  permissionUndetermined();

  const screen = await render(<StoriesScreen />);

  expect(await screen.findByText(deniedBanner)).toBeOnTheScreen();
  expect(screen.getByTestId('place-search')).toBeOnTheScreen();
  expect(screen.queryByTestId('one-door')).toBeNull();
});

test('no flash of the door while the flag is still loading', async () => {
  let resolveFlag!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFlag = resolve;
    })
  );
  permissionUndetermined();

  const screen = await render(<StoriesScreen />);

  // Flag in flight: neither the door nor the denied fallback
  expect(screen.queryByTestId('one-door')).toBeNull();
  expect(screen.queryByText(deniedBanner)).toBeNull();

  // The flag resolves as never-dismissed — only now does the door open
  resolveFlag(null);
  expect(await screen.findByTestId('one-door')).toBeOnTheScreen();
});
