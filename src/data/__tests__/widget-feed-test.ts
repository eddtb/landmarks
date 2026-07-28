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
  widgetDistance,
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

const mockDownload = jest.fn();
const mockCreate = jest.fn();
const mockDeleted: string[] = [];
let mockDirectoryContents: string[] = [];
let mockExisting: string[] = [];
// The real download can resolve cleanly having written nothing —
// exactly what a missing shared directory does on a fresh install
let mockSilentWrite = false;

jest.mock('expo-widgets', () => ({ widgetsDirectory: 'file:///widgets/' }));

jest.mock('expo-file-system', () => ({
  Directory: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    create(options: unknown) {
      mockCreate(options);
    }
    list() {
      return mockDirectoryContents.map((name) => ({
        name,
        delete: () => mockDeleted.push(name),
      }));
    }
  },
  File: class {
    name: string;
    uri: string;
    constructor(directory: { uri: string }, name: string) {
      this.name = name;
      this.uri = `${directory.uri}${name}`;
    }
    get exists() {
      return mockExisting.includes(this.name);
    }
    // A static METHOD, not an arrow property: as an initialised field
    // TypeScript reads it as circular and infers `any` (TS7022)
    static downloadFileAsync(url: string, target: { uri: string; name: string }) {
      mockDownload(url, target.uri);
      // The real API writes to disk; the `exists` check after it is
      // load-bearing, so the mock has to become truthful too
      if (!mockSilentWrite) {
        mockExisting.push(target.name);
      }
      return Promise.resolve(target);
    }
  },
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
  mockDirectoryContents = [];
  mockExisting = [];
  mockDeleted.length = 0;
  mockSilentWrite = false;
});

/** Let the photo leg's promise chain settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('what the widget is told', () => {
  it('names the nearest place and how far it is', () => {
    const props = nearestStoryProps([item(2, 'The Wharf', 800), item(1, 'The Mill', 40)]);

    expect(props.title).toBe('The Mill');
    expect(props.distance).toBe('40 m away');
    expect(props.url).toBe('landmarks:///history/1');
  });

  it('speaks in the words the feed uses: here, metres, then minutes', () => {
    // "1 min walk" for thirty metres is the kind of rounding that
    // makes an app feel like it isn't really looking
    expect(widgetDistance(12)).toBe('right here');
    expect(widgetDistance(310)).toBe('310 m away');
    expect(widgetDistance(1600)).toContain('min walk');
  });

  it("carries Wikidata's existence fact, and stays silent without one", () => {
    expect(nearestStoryProps([item(1, 'The Mill', 40, { pastTag: 'Demolished 1936' })]).era).toBe(
      'Demolished 1936'
    );
    expect(nearestStoryProps([item(1, 'The Mill', 40)]).era).toBe('');
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
    expect(nearestStoryProps([])).toEqual({
      title: '',
      hook: '',
      distance: '',
      era: '',
      url: '',
      photo: '',
      emptyNote: 'No recorded history right here.',
    });
  });

  it('shows an honest nothing when everything nearby is unwalkable', () => {
    expect(nearestStoryProps([item(1, 'A Fire', 10, { event: true })]).title).toBe('');
  });

  it('distinguishes "nothing here" from "never opened"', () => {
    // The widget's own default says "Open Venture…", which is right
    // before the app has ever run and wrong in the middle of the North
    // Sea. Only a real, empty feed carries the note.
    expect(nearestStoryProps([]).emptyNote).toBe('No recorded history right here.');
    expect(nearestStoryProps([item(1, 'The Mill', 40)]).emptyNote).toBe('');
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

  it('shows the words first and the photograph after', async () => {
    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);

    // The first push carries no picture — a download is a round trip,
    // and the Home Screen must not sit on yesterday's place meanwhile
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUpdateSnapshot.mock.calls[0][0].photo).toBe('');

    await settle();

    expect(mockDownload).toHaveBeenCalledWith('https://x/mill.jpg', 'file:///widgets/nearest-1.jpg');
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(2);
    expect(mockUpdateSnapshot.mock.calls[1][0].photo).toBe('file:///widgets/nearest-1.jpg');
  });

  it('sweeps the previous place’s photograph out of the shared container', async () => {
    mockDirectoryContents = ['nearest-99.jpg', 'unrelated.txt'];

    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);
    await settle();

    expect(mockDeleted).toEqual(['nearest-99.jpg']);
  });

  it('does not download a photograph it already has', async () => {
    mockExisting = ['nearest-1.jpg'];

    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);
    await settle();

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdateSnapshot.mock.calls[1][0].photo).toBe('file:///widgets/nearest-1.jpg');
  });

  it('creates the shared directory first — a download into a missing one fails silently', async () => {
    // Measured on the simulator: on a fresh install the first launch
    // wrote no file at all, yet still handed the widget a path to one.
    // Every first-ever user would have had a picture-less widget.
    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);
    await settle();

    expect(mockCreate).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
  });

  it('does not claim a photo the download quietly failed to write', async () => {
    // The disk is the authority, not the call
    mockSilentWrite = true;

    updateNearestWidget([item(7, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);
    await settle();

    // Only the text push happened — no second push claiming a picture
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUpdateSnapshot.mock.calls[0][0].photo).toBe('');
  });

  it('leaves the widget plain rather than broken when the photo fails', async () => {
    mockDownload.mockImplementation(() => {
      throw new Error('offline');
    });

    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })]);
    await settle();

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUpdateSnapshot.mock.calls[0][0].title).toBe('The Mill');
  });

  it('skips the photo leg entirely for a place with no picture', async () => {
    updateNearestWidget([item(1, 'The Mill', 40, { thumbnailUrl: undefined })]);
    await settle();

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed widget update break the app', () => {
    mockUpdateSnapshot.mockImplementation(() => {
      throw new Error('WidgetKit unavailable');
    });

    expect(() => updateNearestWidget([item(1, 'The Mill', 40)])).not.toThrow();
  });
});
