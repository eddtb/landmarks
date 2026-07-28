/**
 * What the Home Screen is told. The widget runtime has no hooks, no
 * async work and no access to this app's helpers, so everything it
 * shows is computed here — which makes this the only place the
 * widget's correctness can be tested at all.
 */
import {
  nearestStoryProps,
  resetWidgetFeedForTests,
  updateNearestWidget,
} from '@/data/widget-feed';
import { HistoryItem } from '@/types/history';

// Safe above the imports: the factory only closes over this lazily
const mockUpdateSnapshot = jest.fn();

jest.mock('@/widgets/nearest-story', () => ({
  __esModule: true,
  default: { updateSnapshot: (...args: unknown[]) => mockUpdateSnapshot(...args) },
}));

// The real createURL reads the Expo manifest, which no test has —
// this pins the scheme so the deep link's SHAPE stays asserted
jest.mock('expo-linking', () => ({
  createURL: (path: string) => `landmarks://${path}`,
}));

const item = (
  pageId: number,
  title: string,
  distanceMeters: number,
  extra: Partial<HistoryItem> = {}
): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters,
  extract: `${title} was a debtors' prison that stood for two centuries.`,
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  resetWidgetFeedForTests();
});

describe('what the widget is told', () => {
  it('names the nearest place and how far it is', () => {
    const props = nearestStoryProps([item(2, 'The Wharf', 800), item(1, 'The Mill', 40)]);

    expect(props.title).toBe('The Mill');
    expect(props.distance).toContain('away');
    expect(props.url).toBe('landmarks:///history/1');
  });

  it('skips what cannot be arrived at', () => {
    const props = nearestStoryProps([
      item(1, 'A Train Crash', 10, { event: true }),
      item(2, 'Greenwich', 20, { area: true }),
      item(3, 'The Mill', 900),
    ]);

    expect(props.title).toBe('The Mill');
  });

  it("uses a plaque's subject rather than its inscription", () => {
    const props = nearestStoryProps([
      item(1, 'Erected by the council in 1968…', 10, { subject: 'Ada Lovelace' }),
    ]);

    expect(props.title).toBe('Ada Lovelace');
  });

  it('drops a hook that only restates the name — the title sits above it', () => {
    const props = nearestStoryProps([item(1, 'The Mill', 10)]);

    expect(props.hook).toBe('');
  });

  it('drops a restating hook even when it opens with an article', () => {
    // Read off the simulator's App Group container: the widget was
    // handed "Royal Naval College, Greenwich" and then a hook opening
    // "The Royal Naval College, Greenwich, was…" — one word of
    // difference, and a bare prefix test lets it straight through
    const props = nearestStoryProps([
      item(1, 'Royal Naval College, Greenwich', 34, {
        extract:
          'The Royal Naval College, Greenwich, was a Royal Navy training establishment between 1873 and 1998.',
      }),
    ]);

    expect(props.hook).toBe('');
  });

  it('keeps a hook that says something the name does not', () => {
    const props = nearestStoryProps([
      item(1, 'The Mill', 10, { extract: 'A prison stood on this ground until 1842.' }),
    ]);

    expect(props.hook).toContain('1842');
  });

  it('shows an honest nothing when there is no feed yet', () => {
    expect(nearestStoryProps([])).toEqual({ title: '', hook: '', distance: '', url: '' });
  });

  it('shows an honest nothing when everything nearby is unwalkable', () => {
    expect(nearestStoryProps([item(1, 'A Fire', 10, { event: true })]).title).toBe('');
  });
});

describe('pushing to the Home Screen', () => {
  it('tells the widget when the nearest story changes', () => {
    updateNearestWidget([item(1, 'The Mill', 40)]);
    updateNearestWidget([item(2, 'The Wharf', 30)]);

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(2);
    expect(mockUpdateSnapshot.mock.calls[1][0].title).toBe('The Wharf');
  });

  it('stays quiet when nothing has changed — reloads are rate-limited', () => {
    updateNearestWidget([item(1, 'The Mill', 40)]);
    updateNearestWidget([item(1, 'The Mill', 40)]);
    updateNearestWidget([item(1, 'The Mill', 40)]);

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('speaks up when the same place gets nearer', () => {
    updateNearestWidget([item(1, 'The Mill', 400)]);
    updateNearestWidget([item(1, 'The Mill', 40)]);

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(2);
  });

  it('never lets a failed widget update break the app', () => {
    mockUpdateSnapshot.mockImplementation(() => {
      throw new Error('WidgetKit unavailable');
    });

    expect(() => updateNearestWidget([item(1, 'The Mill', 40)])).not.toThrow();
  });
});
