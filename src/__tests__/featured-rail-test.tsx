/**
 * The middle layer for the newest Nearby components: what the user
 * actually sees and taps, rendered in-process. Logic-level tests
 * already pin featuredStories() and standingOn(); these pin the
 * wiring — items in, cards out, taps navigating to the right story.
 */
import { fireEvent, render } from '@testing-library/react-native';

import { FeaturedRail, StandingOnIt } from '@/components/section-screen';
import { story } from '@/test-utils/story';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, router: { ...actual.router, push: (...args: unknown[]) => mockPush(...args) } };
});

beforeEach(() => mockPush.mockClear());

describe('FeaturedRail', () => {
  const cuttySark = story({ pageId: 7, title: 'Cutty Sark', source: 'Historic England · Grade I' });
  const queensHouse = story({ pageId: 8, title: "Queen's House", extract: 'x'.repeat(400) });
  const plainStreet = story({ pageId: 9, title: 'Some Street' });

  test('renders a card per featured story with its walk time', async () => {
    const { getByText, getAllByText } = await render(
      <FeaturedRail items={[plainStreet, cuttySark, queensHouse]} />
    );
    expect(getByText('Featured')).toBeOnTheScreen();
    expect(getByText('Cutty Sark')).toBeOnTheScreen();
    expect(getByText("Queen's House")).toBeOnTheScreen();
    // 400m at ~1.33 m/s ≈ 5 min — the same estimate cards use
    expect(getAllByText(/min walk/).length).toBeGreaterThan(0);
  });

  test('tapping a card opens THAT story', async () => {
    const { getByText } = await render(<FeaturedRail items={[cuttySark, queensHouse]} />);
    fireEvent.press(getByText('Cutty Sark'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '7' },
    });
  });

  test('fewer than two featured stories: the rail stays off the screen', async () => {
    const { queryByText } = await render(<FeaturedRail items={[cuttySark]} />);
    expect(queryByText('Featured')).toBeNull();
  });

  test('the standing-on item is not featured twice', async () => {
    const { queryByText } = await render(
      <FeaturedRail items={[cuttySark, queensHouse, plainStreet]} excludePageId={7} />
    );
    expect(queryByText('Cutty Sark')).toBeNull();
  });
});

describe('StandingOnIt', () => {
  const here = { latitude: 51.48, longitude: 0 };

  test('says "right here" when you are on top of it, and opens the story on tap', async () => {
    const item = story({ pageId: 3, title: 'Greenwich Foot Tunnel', coordinates: here });
    const { getByText } = await render(<StandingOnIt item={item} center={here} />);
    expect(getByText("You're standing on it")).toBeOnTheScreen();
    expect(getByText(/right here/)).toBeOnTheScreen();
    fireEvent.press(getByText('Greenwich Foot Tunnel'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '3' },
    });
  });

  test('shows live metres when a few steps away', async () => {
    const item = story({
      pageId: 4,
      title: 'The Gate',
      coordinates: { latitude: 51.4803, longitude: 0 }, // ~33m north
    });
    const { getByText } = await render(<StandingOnIt item={item} center={here} />);
    expect(getByText(/\d+ m from you/)).toBeOnTheScreen();
  });
});
