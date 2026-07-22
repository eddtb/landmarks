/**
 * The Dorking case, at the wire (device-triaged, deterministic):
 * Apple's reverse geocoder answers the WARD — "Dorking North" — and the
 * server has no article and no retelling for a ward, so the gazetteer
 * showed bare relics with no hero and no explanation. The cascade
 * probes the ward, hears the 404, and falls through to the name that
 * answers: THE STORY OF Dorking, retold asked with "Dorking".
 */
import { act, render, screen } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { resetAreaNameCacheForTests, useAreaName } from '@/hooks/use-area-name';
import { clearPin } from '@/hooks/use-pin';
import { HistoryItem } from '@/types/history';
import { Coordinates } from '@/utils/geo';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const mockReverseGeocodeAsync = jest.fn();
jest.mock('expo-location', () => ({
  reverseGeocodeAsync: (...args: unknown[]) => mockReverseGeocodeAsync(...args),
}));

const dorking: Coordinates = { latitude: 51.2325, longitude: -0.3306 };

const dorkingArticle = {
  minutes: 6,
  images: [],
  chapters: [{ title: '', paragraphs: ['A market town below Box Hill.'] }],
};

const dorkingRetold = {
  minutes: 3,
  timeline: [],
  parts: [{ heading: 'The market below the hill', body: 'Chalk and chickens made the town.' }],
};

/** The server as the wire saw it: 200s only for "Dorking". */
function serveDorkingOnly() {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes('/api/article')) {
      if (path.includes('title=Dorking&') || path.endsWith('title=Dorking')) {
        return { ok: true, status: 200, json: async () => ({ article: dorkingArticle }) };
      }
      return { ok: false, status: 404 }; // the ward, the subregion…
    }
    if (path.includes('/api/retold')) {
      if (path.includes('area=Dorking&') || path.endsWith('area=Dorking')) {
        return { ok: true, status: 200, json: async () => ({ retold: dorkingRetold }) };
      }
      return { ok: false, status: 404 };
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

/** The real hook feeding the real gazetteer — the two tabs' shape. */
function Harness({ center, relics = [] }: { center: Coordinates; relics?: HistoryItem[] }) {
  const { name, settled } = useAreaName(center);
  return (
    <AreaGazetteer
      areaName={name}
      areaSettled={settled}
      relics={relics}
      allStories={relics}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPin();
  resetAreaNameCacheForTests();
});

describe('the Dorking case (ward 404 → the cascade finds the town)', () => {
  test('the ward is probed, 404s, and "Dorking" leads the screen — retold asked with "Dorking"', async () => {
    mockReverseGeocodeAsync.mockResolvedValue([
      { district: 'Dorking North', subregion: 'Mole Valley', city: 'Dorking' },
    ]);
    serveDorkingOnly();

    await render(<Harness center={dorking} />);

    // The hero paints the WINNER — the town, not the ward
    expect(await screen.findByText('The story of')).toBeOnTheScreen();
    expect(screen.getByText('Dorking')).toBeOnTheScreen();
    expect(screen.queryByText('Dorking North')).toBeNull();

    // …and the retelling arrived, asked for by the winning name
    expect(await screen.findByText('The market below the hill')).toBeOnTheScreen();

    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    // The wire order the diagnosis predicted: ward asked and refused
    // BEFORE the town answered
    const wardProbe = urls.findIndex((url) => url.includes('title=Dorking%20North'));
    const townAsk = urls.findIndex((url) => url.includes('title=Dorking&'));
    expect(wardProbe).toBeGreaterThanOrEqual(0);
    expect(townAsk).toBeGreaterThan(wardProbe);
    // The retold ask uses the cascade winner — never the ward
    expect(urls.some((url) => url.includes('/api/retold?area=Dorking'))).toBe(true);
    expect(urls.some((url) => url.includes('area=Dorking%20North'))).toBe(false);

    // The retold rows schedule a follow-up render batch — let it fire
    // inside act so the test ends quiet
    await act(async () => new Promise((resolve) => setTimeout(resolve, 60)));
  });

  test('mid-sea (#217): nothing resolves and the gazetteer reaches its empty state, not a forever-spinner', async () => {
    mockReverseGeocodeAsync.mockResolvedValue([]);
    serveDorkingOnly();

    await render(<Harness center={{ latitude: 48.8767, longitude: -12.4149 }} />);

    expect(
      await screen.findByText('Nothing hidden here that the records know of.')
    ).toBeOnTheScreen();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('a named area with no article anywhere says so above its relics — in words', async () => {
    mockReverseGeocodeAsync.mockResolvedValue([{ district: 'Atlantis Ward' }]);
    serveDorkingOnly(); // Atlantis Ward 404s everywhere

    const relic: HistoryItem = {
      pageId: 9,
      title: 'Sunken Boundary Stone',
      coordinates: dorking,
      distanceMeters: 80,
      url: 'https://example.org/stone',
      source: 'Historic England',
    };
    await render(<Harness center={{ latitude: 51.9, longitude: -0.9 }} relics={[relic]} />);

    expect(
      await screen.findByText('No recorded story for this area yet — its relics are below.')
    ).toBeOnTheScreen();
    expect(screen.getByText('Sunken Boundary Stone')).toBeOnTheScreen();
  });
});
