import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

describe('<HomeScreen />', () => {
  test('renders the welcome title', async () => {
    await render(<HomeScreen />);

    // The title contains a non-breaking space ( ) between "to" and "Expo"
    expect(screen.getByText(/Welcome to[\s ]Expo/)).toBeOnTheScreen();
  });
});
