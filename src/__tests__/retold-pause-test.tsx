/**
 * The sequential retold reader through a pause.
 *
 * The reader speaks parts in order, so a pause has more to protect
 * than a single utterance: the loop must hold where it stands — never
 * advance to Part n+1 over a paused body — and a resume must carry on
 * mid-part, not restart or skip. Pinned here against the real
 * AreaGazetteer with a scripted engine: the utterance queue records
 * every speak, and the tests read the queue like a transcript.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { Retold } from '@/types/retold';

type Handlers = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

const mockEngine: {
  utterances: { text: string; options: Handlers }[];
  resumeRejects: boolean;
  pause: jest.Mock;
  resume: jest.Mock;
  stop: jest.Mock;
} = {
  utterances: [],
  resumeRejects: false,
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {
    if (mockEngine.resumeRejects) {
      throw new Error('the synthesizer refused');
    }
  }),
  stop: jest.fn(async () => {
    mockEngine.utterances.at(-1)?.options.onStopped?.();
  }),
};

jest.mock('expo-speech', () => ({
  speak: (text: string, options: Handlers) => {
    mockEngine.utterances.push({ text, options });
  },
  stop: (...args: unknown[]) => mockEngine.stop(...args),
  pause: (...args: unknown[]) => mockEngine.pause(...args),
  resume: (...args: unknown[]) => mockEngine.resume(...args),
  isSpeakingAsync: async () => true,
  getAvailableVoicesAsync: async () => [],
}));

jest.mock('expo-audio', () => ({ setAudioModeAsync: async () => {} }));

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const article = {
  minutes: 6,
  images: [],
  chapters: [{ title: '', paragraphs: ['The old palace stood here.'] }],
};

const retold: Retold = {
  minutes: 7,
  brief: ['The last tea clipper.'],
  timeline: [],
  parts: [
    { heading: 'Birthplace of Kings', body: 'Part one’s prose.' },
    { heading: 'Tudor Favourite', body: 'Part two’s prose.' },
  ],
};

function serve() {
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes('/api/retold')) {
      return { ok: true, status: 200, json: async () => ({ retold }) };
    }
    if (path.includes('/api/article')) {
      return { ok: true, status: 200, json: async () => ({ article }) };
    }
    if (path.includes('/api/telling')) {
      return { ok: true, status: 200, json: async () => ({ telling: 'Venture’s telling.' }) };
    }
    throw new Error(`Unexpected fetch: ${path}`);
  });
}

async function paintAndListen(areaName: string) {
  serve();
  await render(
    <AreaGazetteer
      areaName={areaName}
      relics={[]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
  await act(async () => {
    fireEvent.press(await screen.findByText('Listen'));
  });
  // The reader announces the part, then reads its body
  expect(mockEngine.utterances[0].text).toBe('Part 1: Birthplace of Kings.');
  await act(async () => {
    mockEngine.utterances[0].options.onDone?.();
  });
  expect(mockEngine.utterances[1].text).toBe('Part one’s prose.');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngine.utterances = [];
  mockEngine.resumeRejects = false;
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
});

describe('the part loop under pause', () => {
  test('paused mid-part, the loop holds; resumed, the same part carries on', async () => {
    await paintAndListen('Cutty Sark');

    await act(async () => {
      fireEvent.press(screen.getByText('Pause'));
    });
    expect(await screen.findByText('Resume')).toBeOnTheScreen();
    expect(screen.getByText('Stop')).toBeOnTheScreen();

    // A pause is a pause — not a stop the loop would read as "next"
    expect(mockEngine.pause).toHaveBeenCalledTimes(1);
    expect(mockEngine.stop).not.toHaveBeenCalled();
    // …and the loop has NOT advanced: no new utterance while paused
    await act(async () => {});
    expect(mockEngine.utterances).toHaveLength(2);

    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });
    expect(await screen.findByText('Pause')).toBeOnTheScreen();
    // Still mid-part: resuming continued the SAME utterance
    expect(mockEngine.utterances).toHaveLength(2);

    // Only when the body actually finishes does Part 2 begin
    await act(async () => {
      mockEngine.utterances[1].options.onDone?.();
    });
    expect(mockEngine.utterances).toHaveLength(3);
    expect(mockEngine.utterances[2].text).toBe('Part 2: Tudor Favourite.');
  });

  test('Stop from paused ends the reading — the loop is dead, Listen returns', async () => {
    await paintAndListen('Cutty Sark, stopped');

    await act(async () => {
      fireEvent.press(screen.getByText('Pause'));
    });
    await screen.findByText('Resume');

    await act(async () => {
      fireEvent.press(screen.getByText('Stop'));
    });
    expect(mockEngine.stop).toHaveBeenCalled();
    expect(await screen.findByText('Listen')).toBeOnTheScreen();
    // Nothing more is spoken: the loop did not advance past the stop
    await act(async () => {});
    expect(mockEngine.utterances).toHaveLength(2);
  });

  test('a resume the engine refuses stops the reading and says so', async () => {
    await paintAndListen('Cutty Sark, refused');

    await act(async () => {
      fireEvent.press(screen.getByText('Pause'));
    });
    await screen.findByText('Resume');

    mockEngine.resumeRejects = true;
    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });

    // Said in words — and the loop reads no further part over it
    expect(await screen.findByText('Speech failed · retry')).toBeOnTheScreen();
    expect(mockEngine.utterances).toHaveLength(2);
  });
});
