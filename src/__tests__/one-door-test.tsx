/**
 * The one door (approved round-2 Option A): the single first-run gate
 * that replaced the three-card onboarding AND the old location-priming
 * screen. It lives at the ROOT as an overlay above the tab navigator —
 * inside a tab's LocationGate the floating tab pill sat on top of it
 * (sim-caught). These pin the contract: shown only while permission is
 * undetermined and "Not now" isn't on record, Enable is the app's one
 * permission-request path, "Not now" is remembered and LocationGate
 * falls through to the denied-state UI (banner + search), and a
 * returning dismisser never sees a flash of the door.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ONE_DOOR_DISMISSED_KEY, OneDoorGate, resetOneDoorForTests } from '@/components/one-door';
import { StoriesScreen } from '@/components/section-screen';
import { clearPin } from '@/hooks/use-pin';

const mockUseLocation = jest.fn();
const mockUseLocationPermission = jest.fn();
const mockRequestLocationPermission = jest.fn();
jest.mock('@/hooks/use-location', () => ({
  useLocation: () => mockUseLocation(),
  useLocationPermission: () => mockUseLocationPermission(),
  requestLocationPermission: () => mockRequestLocationPermission(),
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

/** iOS hasn't been asked yet — the only state where the door shows. */
function permissionUndetermined() {
  mockUseLocationPermission.mockReturnValue({
    granted: false,
    status: 'undetermined',
    canAskAgain: true,
  });
  mockUseLocation.mockReturnValue({ status: 'priming', coordinates: null });
}

function permissionDetermined(status: 'granted' | 'denied') {
  mockUseLocationPermission.mockReturnValue({
    granted: status === 'granted',
    status,
    canAskAgain: false,
  });
}

/** The root gate next to the app, the way _layout.tsx mounts it. */
const atRoot = () => (
  <>
    <Text>the app underneath</Text>
    <OneDoorGate />
  </>
);

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  // The dismissed store is module-level — start every test fresh
  resetOneDoorForTests();
  clearPin();
  mockUseHistory.mockReturnValue({ state: { status: 'ready', items: [] }, refresh: jest.fn() });
});

describe('the root overlay (OneDoorGate)', () => {
  test('permission undetermined: the door covers the app, tab pill and all', async () => {
    permissionUndetermined();
    const screen = await render(atRoot());

    expect(await screen.findByTestId('one-door')).toBeOnTheScreen();
    // The app still renders underneath…
    expect(screen.getByText('the app underneath')).toBeOnTheScreen();
    // …but the overlay is a full-screen absolute layer above the tab
    // navigator (zIndex 500, under only the splash's 1000) — nothing
    // beneath it, the floating pill included, is reachable
    expect(screen.getByTestId('one-door-overlay')).toHaveStyle({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 500,
    });
    // The copy and both actions, per the mock
    expect(screen.getByText('VENTURE')).toBeOnTheScreen();
    expect(
      screen.getByRole('header', { name: 'The history within a walk of you' })
    ).toBeOnTheScreen();
    expect(screen.getByTestId('one-door-enable')).toBeOnTheScreen();
    expect(screen.getByTestId('one-door-not-now')).toBeOnTheScreen();
  });

  test('"Enable location" is the one permission-request path', async () => {
    permissionUndetermined();
    const screen = await render(atRoot());

    fireEvent.press(await screen.findByTestId('one-door-enable'));

    expect(mockRequestLocationPermission).toHaveBeenCalledTimes(1);
    // The door stays up — it leaves only when the permission status does
    expect(screen.getByTestId('one-door')).toBeOnTheScreen();
  });

  test('"Not now" persists the flag and takes the door down', async () => {
    permissionUndetermined();
    const screen = await render(atRoot());

    fireEvent.press(await screen.findByTestId('one-door-not-now'));

    await waitFor(() => expect(screen.queryByTestId('one-door')).toBeNull());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONE_DOOR_DISMISSED_KEY, 'true');
  });

  test('a dismissed flag skips the door on later launches', async () => {
    await AsyncStorage.setItem(ONE_DOOR_DISMISSED_KEY, 'true');
    permissionUndetermined();

    const screen = await render(atRoot());

    await waitFor(() =>
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(ONE_DOOR_DISMISSED_KEY)
    );
    expect(screen.queryByTestId('one-door')).toBeNull();
  });

  test('a determined permission never shows the door', async () => {
    permissionDetermined('granted');
    const screen = await render(atRoot());
    await waitFor(() =>
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(ONE_DOOR_DISMISSED_KEY)
    );
    expect(screen.queryByTestId('one-door')).toBeNull();

    permissionDetermined('denied');
    await screen.rerender(atRoot());
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

    const screen = await render(atRoot());

    // Flag in flight: the gate adds nothing
    expect(screen.queryByTestId('one-door')).toBeNull();

    // The flag resolves as never-dismissed — only now does the door open
    resolveFlag(null);
    expect(await screen.findByTestId('one-door')).toBeOnTheScreen();
  });
});

describe('LocationGate beneath the door', () => {
  test('undetermined + dismissed: falls through to the denied UI', async () => {
    await AsyncStorage.setItem(ONE_DOOR_DISMISSED_KEY, 'true');
    permissionUndetermined();

    const screen = await render(<StoriesScreen />);

    expect(await screen.findByText(deniedBanner)).toBeOnTheScreen();
    expect(screen.getByTestId('place-search')).toBeOnTheScreen();
    expect(screen.queryByTestId('one-door')).toBeNull();
  });

  test('undetermined + not dismissed: a quiet loading — the root door owns the screen', async () => {
    permissionUndetermined();

    const screen = await render(<StoriesScreen />);

    await waitFor(() =>
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(ONE_DOOR_DISMISSED_KEY)
    );
    // No denied banner, and no door of its own — that lives at the root
    expect(screen.queryByText(deniedBanner)).toBeNull();
    expect(screen.queryByTestId('one-door')).toBeNull();
  });
});
