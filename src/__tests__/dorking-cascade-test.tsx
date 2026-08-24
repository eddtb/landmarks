/**
 * The Dorking case, at the wire (device-triaged, deterministic):
 * Apple's reverse geocoder answers the WARD — "Dorking North" — and the
 * server has no article and no retelling for a ward, so the gazetteer
 * showed bare relics with no hero and no explanation. The cascade
 * probes the ward, hears the 404, and falls through to the name that
 * answers: THE STORY OF Dorking, retold asked with "Dorking".
 */
import { act, render, screen } from '@testing-library/react-native';
import { ReactNode } from 'react';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { resetAreaNameCacheForTests, useAreaName } from '@/hooks/use-area-name';
import { resetFeedOriginForTests } from '@/hooks/use-feed-origin';
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
    if (path.includes('/api/area?')) {
      // Surrey's real answer, live-probed: nothing near Dorking is
      // area-classed, so this candidate abstains and the ward-then-town
      // cascade below is exactly the one #205 shipped.
      return { ok: true, status: 200, json: async () => ({ name: null }) };
    }
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
function Harness({
  center,
  relics = [],
  lead,
}: {
  center: Coordinates;
  relics?: HistoryItem[];
  lead?: ReactNode;
}) {
  const { name, label, settled } = useAreaName(center);
  return (
    <AreaGazetteer
      areaName={name}
      areaLabel={label}
      areaSettled={settled}
      relics={relics}
      allStories={relics}
      refreshing={false}
      onRefresh={() => {}}
      lead={lead}
    />
  );
}

/** A caller's component that renders nothing — the exact shape that
 *  made the default copy unreachable when it could be handed to the
 *  list's empty slot (#255). */
function RendersNothing(): ReactNode {
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  clearPin();
  resetAreaNameCacheForTests();
  // The feed-origin store is module-level too: an anchor left by one
  // test would name the LAST test's ground (#323's cascade now keys
  // off the origin, not the centre)
  resetFeedOriginForTests();
});

describe('the Dorking case (ward 404 → the cascade finds the town)', () => {
  test('the ward is probed, 404s, and "Dorking" leads the screen — retold asked with "Dorking"', async () => {
    // The real geocoder's shape at Dorking: ward, county, town
    mockReverseGeocodeAsync.mockResolvedValue([
      { district: 'Dorking North', subregion: 'Surrey', city: 'Dorking' },
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

    // The default copy, structurally reachable at last (#292): with no
    // `empty` element in front of it, an area with nothing to show gets
    // an invitation that names the control it points at — the tappable
    // area title in the History header above.
    expect(
      await screen.findByText(
        'Nothing is written down within a walk. Walk on, or tap the name above to look somewhere else.'
      )
    ).toBeOnTheScreen();
    // The area lookup is asked — Wikipedia, not Apple, decides whether
    // this water has a name — and answers nothing. No candidate follows
    // it, so not one article or retold probe is spent on a nameless spot.
    const urls = mockFetch.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual([expect.stringContaining('/api/area?')]);
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

    // …and it says the place's NAME, which the header above it now
    // always shows — "this area" was the copy of a screen that couldn't
    // be sure what area it was on (#292). A 404 from both legs is the
    // one verdict allowed to make this claim (#291), and it makes it
    // without a panel and without a retry.
    expect(await screen.findByText('Wikipedia has no article for Atlantis Ward')).toBeOnTheScreen();
    expect(screen.getByText('One relic stands on this ground anyway. It’s below.')).toBeOnTheScreen();
    expect(screen.getByText('Sunken Boundary Stone')).toBeOnTheScreen();
    expect(screen.queryByTestId('load-failed-area-article')).not.toBeOnTheScreen();
  });
});

/**
 * The ladder's reader-facing contract, on the real component: whatever
 * a caller hands in, a settled screen with nothing to list reaches the
 * default copy. The old `empty` prop broke this for every caller whose
 * component could render nothing — the branch was taken on the
 * element's existence, and an element that renders null still exists.
 */
describe('no caller can stand in front of the empty state', () => {
  const nowhere = { latitude: 48.8767, longitude: -12.4149 };

  const callers: { what: string; lead?: ReactNode }[] = [
    { what: 'a caller that hands in nothing at all' },
    { what: 'a caller whose component renders null', lead: <RendersNothing /> },
    { what: 'a caller whose component renders a fragment of nothing', lead: <></> },
  ];

  test.each(callers)('$what still reaches the default copy', async ({ lead }) => {
    mockReverseGeocodeAsync.mockResolvedValue([]);
    serveDorkingOnly();

    await render(<Harness center={nowhere} lead={lead} />);

    expect(await screen.findByTestId('gazetteer-empty')).toBeOnTheScreen();
    expect(
      screen.getByText(
        'Nothing is written down within a walk. Walk on, or tap the name above to look somewhere else.'
      )
    ).toBeOnTheScreen();
  });
});
