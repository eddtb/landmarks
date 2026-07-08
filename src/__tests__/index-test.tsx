import { fireEvent, render, screen } from '@testing-library/react-native';

import BrowseScreen from '@/app/index';

describe('<BrowseScreen />', () => {
  test('shows landmarks by default, nearest first', async () => {
    await render(<BrowseScreen />);

    expect(screen.getByText('Nearby')).toBeOnTheScreen();
    // Tower Bridge (350 m) is the nearest mock landmark
    expect(screen.getByText('Tower Bridge')).toBeOnTheScreen();
    // Pubs are not shown in the landmark section
    expect(screen.queryByText('The George Inn')).not.toBeOnTheScreen();
  });

  test('switching section shows that category', async () => {
    await render(<BrowseScreen />);

    fireEvent.press(screen.getByText('Pubs'));

    expect(await screen.findByText('The George Inn')).toBeOnTheScreen();
    expect(screen.queryByText('Tower Bridge')).not.toBeOnTheScreen();
  });
});
