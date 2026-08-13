/**
 * What the Home Screen is told. The widget runtime has no hooks, no
 * async work and no access to this app's helpers, so everything it
 * shows is computed here — which makes this the only place the
 * widget's correctness can be tested at all.
 */
import {
  areaStoriesProps,
  resetWidgetFeedForTests,
  updateAreaWidget,
  widgetDistance,
} from '@/data/area-widget';
import { HistoryItem } from '@/types/history';

// Safe above the imports: the factory only closes over this lazily
const mockUpdateSnapshot = jest.fn();

jest.mock('@/widgets/area-stories', () => ({
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
  const greenwich = [item(1, 'Cutty Sark', 31), item(2, 'The Wharf', 400)];

  it('counts the area and names where it is', () => {
    const props = areaStoriesProps(greenwich, 'Greenwich');

    expect(props.count).toBe(2);
    expect(props.area).toBe('Greenwich');
  });

  it('counts what it is given — the feed decides what is walkable, not this', () => {
    // The count line and the widget print the SAME number, so the
    // filtering lives in one shared place (walkableStories) and this
    // must not quietly apply a second opinion on top of it
    expect(areaStoriesProps(greenwich, 'Greenwich').count).toBe(greenwich.length);
  });

  it('names the nearest for the wider size, and how far it is', () => {
    const props = areaStoriesProps(greenwich, 'Greenwich');

    expect(props.nearest).toBe('Cutty Sark');
    expect(props.nearestWalk).toBe('31 m away');
  });

  it("uses a plaque's subject rather than its inscription", () => {
    const props = areaStoriesProps(
      [item(1, 'Erected by the council in 1968…', 10, { subject: 'Ada Lovelace' })],
      'Greenwich'
    );

    expect(props.nearest).toBe('Ada Lovelace');
  });

  it('opens the feed, not one arbitrary member of it', () => {
    // A widget that counts what is around you should show the list
    expect(areaStoriesProps(greenwich, 'Greenwich').url).toBe('landmarks:///');
  });

  it('speaks in the words the feed uses: here, metres, then minutes', () => {
    // "1 min walk" for thirty metres is the kind of rounding that
    // makes an app feel like it isn't really looking
    expect(widgetDistance(12)).toBe('right here');
    expect(widgetDistance(310)).toBe('310 m away');
    expect(widgetDistance(1600)).toContain('min walk');
  });

  it('stays countable when the area could not be named', () => {
    const props = areaStoriesProps(greenwich, null);

    expect(props.count).toBe(2);
    expect(props.area).toBe('');
  });

  it('shows an honest nothing when there is nothing to count', () => {
    expect(areaStoriesProps([], 'Greenwich')).toEqual({
      area: '',
      count: 0,
      nearest: '',
      nearestWalk: '',
      url: '',
      photo: '',
      emptyNote: 'No recorded history right here.',
    });
  });

  it('distinguishes "nothing here" from "never opened"', () => {
    // The widget's own default says "Open Venture…", which is right
    // before the app has ever run and wrong in the middle of the North
    // Sea. Only a real, empty feed carries the note.
    expect(areaStoriesProps([], 'Greenwich').emptyNote).toBe('No recorded history right here.');
    expect(areaStoriesProps(greenwich, 'Greenwich').emptyNote).toBe('');
  });
});

describe('pushing to the Home Screen', () => {
  it('tells the widget when what is around the user changes', () => {
    updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich');
    updateAreaWidget([item(2, 'The Wharf', 30)], 'Greenwich');

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(2);
    expect(mockUpdateSnapshot.mock.calls[1][0].nearest).toBe('The Wharf');
  });

  it('stays quiet when nothing has changed — reloads are rate-limited', () => {
    updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich');
    updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich');
    updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich');

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('speaks up when the same place gets nearer', () => {
    updateAreaWidget([item(1, 'The Mill', 400)], 'Greenwich');
    updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich');

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(2);
  });

  it('shows the words first and the photograph after', async () => {
    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');

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

    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');
    await settle();

    expect(mockDeleted).toEqual(['nearest-99.jpg']);
  });

  it('does not download a photograph it already has', async () => {
    mockExisting = ['nearest-1.jpg'];

    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');
    await settle();

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdateSnapshot.mock.calls[1][0].photo).toBe('file:///widgets/nearest-1.jpg');
  });

  it('creates the shared directory first — a download into a missing one fails silently', async () => {
    // Measured on the simulator: on a fresh install the first launch
    // wrote no file at all, yet still handed the widget a path to one.
    // Every first-ever user would have had a picture-less widget.
    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');
    await settle();

    expect(mockCreate).toHaveBeenCalledWith({ intermediates: true, idempotent: true });
  });

  it('does not claim a photo the download quietly failed to write', async () => {
    // The disk is the authority, not the call
    mockSilentWrite = true;

    updateAreaWidget([item(7, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');
    await settle();

    // Only the text push happened — no second push claiming a picture
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUpdateSnapshot.mock.calls[0][0].photo).toBe('');
  });

  it('leaves the widget plain rather than broken when the photo fails', async () => {
    mockDownload.mockImplementation(() => {
      throw new Error('offline');
    });

    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: 'https://x/mill.jpg' })], 'Greenwich');
    await settle();

    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(mockUpdateSnapshot.mock.calls[0][0].nearest).toBe('The Mill');
  });

  it('skips the photo leg entirely for a place with no picture', async () => {
    updateAreaWidget([item(1, 'The Mill', 40, { thumbnailUrl: undefined })], 'Greenwich');
    await settle();

    expect(mockDownload).not.toHaveBeenCalled();
    expect(mockUpdateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed widget update break the app', () => {
    mockUpdateSnapshot.mockImplementation(() => {
      throw new Error('WidgetKit unavailable');
    });

    expect(() => updateAreaWidget([item(1, 'The Mill', 40)], 'Greenwich')).not.toThrow();
  });
});
