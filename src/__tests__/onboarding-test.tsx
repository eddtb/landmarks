/**
 * First-run onboarding: three cards, shown once, skippable. These pin
 * the gate's contract — fresh users get the cards, returning users get
 * the app with no flash of onboarding while the flag loads.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ONBOARDING_SEEN_KEY, OnboardingGate } from '@/components/onboarding';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const TheApp = () => <Text>the app underneath</Text>;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('a fresh user sees all three cards over the app', async () => {
  const screen = await render(
    <OnboardingGate>
      <TheApp />
    </OnboardingGate>
  );

  expect(await screen.findByTestId('onboarding')).toBeOnTheScreen();
  expect(screen.getByText('Stories where you stand')).toBeOnTheScreen();
  expect(screen.getByText('The story of the area')).toBeOnTheScreen();
  expect(screen.getByText('Walk to it')).toBeOnTheScreen();
  // The app renders underneath the whole time — the gate never blanks it
  expect(screen.getByText('the app underneath')).toBeOnTheScreen();
});

test('Skip dismisses the cards and sets the seen flag', async () => {
  const screen = await render(
    <OnboardingGate>
      <TheApp />
    </OnboardingGate>
  );

  fireEvent.press(await screen.findByTestId('onboarding-skip'));

  await waitFor(() => expect(screen.queryByTestId('onboarding')).toBeNull());
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_SEEN_KEY, 'true');
});

test('"Start exploring" dismisses the cards and sets the seen flag', async () => {
  const screen = await render(
    <OnboardingGate>
      <TheApp />
    </OnboardingGate>
  );

  fireEvent.press(await screen.findByTestId('onboarding-done'));

  await waitFor(() => expect(screen.queryByTestId('onboarding')).toBeNull());
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(ONBOARDING_SEEN_KEY, 'true');
});

test('a returning user gets the app, not the onboarding', async () => {
  await AsyncStorage.setItem(ONBOARDING_SEEN_KEY, 'true');

  const screen = await render(
    <OnboardingGate>
      <TheApp />
    </OnboardingGate>
  );

  await waitFor(() => expect(AsyncStorage.getItem).toHaveBeenCalledWith(ONBOARDING_SEEN_KEY));
  expect(screen.getByText('the app underneath')).toBeOnTheScreen();
  expect(screen.queryByTestId('onboarding')).toBeNull();
});

test('no flash of onboarding while the flag is still loading', async () => {
  let resolveFlag!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveFlag = resolve;
    })
  );

  const screen = await render(
    <OnboardingGate>
      <TheApp />
    </OnboardingGate>
  );

  // Flag still in flight: the app is up, the gate adds nothing
  expect(screen.getByText('the app underneath')).toBeOnTheScreen();
  expect(screen.queryByTestId('onboarding')).toBeNull();

  // The flag resolves as unseen — only now do the cards appear
  resolveFlag(null);
  expect(await screen.findByTestId('onboarding')).toBeOnTheScreen();
});
