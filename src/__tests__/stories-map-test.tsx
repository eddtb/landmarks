/**
 * The map that answers 4.2.2: a native map of where you are, on the
 * first screen, with a pin per walkable story. What matters is that the
 * pins ARE the stories (a pin that opens the wrong article is worse
 * than no map) and that the nearest dozen frame the walk rather than
 * the whole 3km feed.
 */
import { render, screen } from '@testing-library/react-native';

import { StoriesMap } from '@/components/stories-map';
import { Colors } from '@/constants/theme';
import { HistoryItem } from '@/types/history';

const mockScheme = jest.fn(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockScheme(),
}));

// jest-setup mocks expo-maps globally, but only so screens can render;
// these tests assert what the native map is HANDED, so they need the
// props kept rather than passed to a View (expo-maps' own props don't
// include testID, so there is nothing to query them by).
const mockMapProps: Record<string, unknown>[] = [];
jest.mock('expo-maps', () => {
  // Renders nothing: what is asserted is the props, and the frame
  // around the map is what tells us a map was placed at all.
  const Fake = (props: Record<string, unknown>) => {
    mockMapProps.push(props);
    return null;
  };
  return { AppleMaps: { View: Fake }, GoogleMaps: { View: Fake } };
});

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...args: unknown[]) => mockPush(...args) } }));

const center = { latitude: 51.4226, longitude: -0.0685 };

const story = (pageId: number, title: string, metres: number): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.4226 + metres / 111_000, longitude: -0.0685 },
  distanceMeters: metres,
  url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, '_')}`,
  source: 'Wikipedia',
});

beforeEach(() => {
  mockMapProps.length = 0;
  jest.clearAllMocks();
  mockScheme.mockReturnValue('light');
});

/** What the native map was handed. */
const mapProps = () => mockMapProps[mockMapProps.length - 1];

describe('StoriesMap', () => {
  test('one pin per story, carrying the pageId that opens it', async () => {
    const items = [story(1, 'Crystal Palace Bowl', 161), story(2, 'Crystal Palace Park', 222)];

    await render(<StoriesMap items={items} origin={center} />);

    const markers = mapProps().markers as { id: string; title: string }[];
    expect(markers).toHaveLength(2);
    expect(markers.map((marker) => marker.id)).toEqual(['1', '2']);
    expect(markers.map((marker) => marker.title)).toEqual([
      'Crystal Palace Bowl',
      'Crystal Palace Park',
    ]);
  });

  test('a story pin is not mistakable for the position dot', async () => {
    await render(<StoriesMap items={[story(1, 'Crystal Palace Park', 222)]} origin={center} />);

    // The dot is the same brand accent, so a bare violet pin differed
    // from "me" only by having a tail — the glyph is what separates them
    const markers = mapProps().markers as { systemImage: string; tintColor: string }[];
    expect(markers[0].systemImage).toBe('building.columns');
    // `toBeTruthy()` stood here, which every string but '' satisfies —
    // the pin could wear ANY colour, the warm accent DESIGN.md reserves
    // for rarity included, and this test would still be green. The pin
    // is violet because violet is what Venture draws with; the value is
    // the palette's, named.
    expect(markers[0].tintColor).toBe(Colors.light.accent);
  });

  test('the pin follows the theme, so it is violet in the dark too', async () => {
    // Read from the theme rather than written down: a literal here
    // would be right in one scheme and wrong in the other, and #6A4BDB
    // on a dark map is the wrong violet (2.79:1 against white).
    mockScheme.mockReturnValue('dark');
    await render(<StoriesMap items={[story(1, 'Crystal Palace Park', 222)]} origin={center} />);

    const markers = mapProps().markers as { tintColor: string }[];
    expect(markers[0].tintColor).toBe(Colors.dark.accent);
    expect(markers[0].tintColor).not.toBe(Colors.light.accent);
  });

  test('tapping a pin opens THAT story — the id is the route parameter', async () => {
    await render(<StoriesMap items={[story(4242, 'Crystal Palace Dinosaurs', 300)]} origin={center} />);

    const onMarkerClick = mapProps().onMarkerClick as (marker: { id?: string }) => void;
    onMarkerClick({ id: '4242' });

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/history/[pageId]',
      params: { pageId: '4242' },
    });
  });

  test('a pin with no id routes nowhere rather than to a broken screen', async () => {
    await render(<StoriesMap items={[story(1, 'Crystal Palace Park', 222)]} origin={center} />);

    (mapProps().onMarkerClick as (marker: { id?: string }) => void)({});

    expect(mockPush).not.toHaveBeenCalled();
  });

  test('the nearest dozen only: the deep feed must not zoom the map to a smudge', async () => {
    const deep = Array.from({ length: 150 }, (_, i) => story(i + 1, `Story ${i + 1}`, 50 + i * 20));

    await render(<StoriesMap items={deep} origin={center} />);

    const markers = mapProps().markers as { id: string }[];
    expect(markers).toHaveLength(12);
    // Distance-sorted by the feed, so the dozen is the NEAREST dozen
    expect(markers[0].id).toBe('1');
    expect(markers[11].id).toBe('12');
  });

  test("your position is on the map; the camera frames the feed's ORIGIN with the pins (#323)", async () => {
    await render(<StoriesMap items={[story(1, 'Crystal Palace Park', 900)]} origin={center} />);

    const properties = mapProps().properties as {
      isMyLocationEnabled: boolean;
      selectionEnabled: boolean;
    };
    expect(properties.isMyLocationEnabled).toBe(true);
    // Off: a tapped pin otherwise stayed drawn at ~3x over its neighbour
    // after returning from the story (caught on the simulator)
    expect(properties.selectionEnabled).toBe(false);
    const camera = mapProps().cameraPosition as { coordinates: { latitude: number }; zoom: number };
    // Centred BETWEEN the origin and the story, not on either one —
    // and it is the ORIGIN the camera frames: the live position moves
    // with every GPS tick and must never steer the camera (#323)
    expect(camera.coordinates.latitude).toBeGreaterThan(center.latitude);
    expect(camera.zoom).toBeGreaterThan(0);
  });

  test('no stories, no map — an empty frame would just be a grey box', async () => {
    await render(<StoriesMap items={[]} origin={center} />);

    expect(screen.queryByTestId('stories-map')).toBeNull();
    expect(mockMapProps).toHaveLength(0);
  });
});
