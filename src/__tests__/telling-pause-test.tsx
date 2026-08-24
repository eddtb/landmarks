/**
 * The words a listener actually sees on the single telling's controls.
 *
 * Playing shows Pause · Stop; paused shows Resume · Stop; the verb
 * keeps its name through the flow (Pause becomes Resume, Stop stays
 * Stop) and a failed resume says so in the same words every engine
 * failure uses. Asserted on the RENDERED buttons, not on the state
 * machine — the state machine has its own suite in
 * src/utils/__tests__/speech-pause-test.ts.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TellingLead, TellingSection } from '@/components/telling-section';
import { HistoryItem } from '@/types/history';

type Handlers = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

const mockEngine: { handlers: Handlers | null; resumeRejects: boolean } = {
  handlers: null,
  resumeRejects: false,
};

jest.mock('expo-speech', () => ({
  speak: (_text: string, options: Handlers) => {
    mockEngine.handlers = options;
  },
  stop: jest.fn(async () => {
    mockEngine.handlers?.onStopped?.();
  }),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {
    if (mockEngine.resumeRejects) {
      throw new Error('the synthesizer refused');
    }
  }),
  isSpeakingAsync: async () => true,
  getAvailableVoicesAsync: async () => [],
}));

jest.mock('expo-audio', () => ({ setAudioModeAsync: async () => {} }));

jest.mock('@/data/telling-client', () => ({
  fetchTelling: async () => 'A short telling of the place.',
}));

const item: HistoryItem = {
  pageId: 42,
  title: 'Newington Butts',
  coordinates: { latitude: 51.49, longitude: -0.1 },
  distanceMeters: 120,
  url: 'https://en.wikipedia.org/wiki/Newington_Butts',
  source: 'Wikipedia',
};

beforeEach(() => {
  mockEngine.handlers = null;
  mockEngine.resumeRejects = false;
});

describe('TellingSection: the pill through a pause', () => {
  test('Pause · Stop while playing, Resume · Stop while paused, and back', async () => {
    await render(<TellingSection item={item} />);

    await act(async () => {
      fireEvent.press(screen.getByText('Listen · about a minute'));
    });

    // Playing: both words, each its own control
    expect(await screen.findByText('Pause')).toBeOnTheScreen();
    expect(screen.getByText('Stop')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByText('Pause'));
    });
    // Paused: the verb keeps its name — Pause has become Resume
    expect(await screen.findByText('Resume')).toBeOnTheScreen();
    expect(screen.getByText('Stop')).toBeOnTheScreen();
    expect(screen.queryByText('Pause')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });
    expect(await screen.findByText('Pause')).toBeOnTheScreen();
    expect(screen.queryByText('Resume')).toBeNull();
  });

  test('Stop from paused lands back on Listen again', async () => {
    await render(<TellingSection item={item} />);
    await act(async () => {
      fireEvent.press(screen.getByText('Listen · about a minute'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Pause'));
    });
    await screen.findByText('Resume');

    await act(async () => {
      fireEvent.press(screen.getByText('Stop'));
    });
    expect(await screen.findByText('Listen again')).toBeOnTheScreen();
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('Stop')).toBeNull();
  });
});

describe('TellingLead: the inline words through a pause', () => {
  test('Listen → Pause · Stop → Resume · Stop → Pause again', async () => {
    await render(<TellingLead item={item} />);

    await act(async () => {
      fireEvent.press(await screen.findByText('Listen'));
    });
    expect(await screen.findByText('Pause')).toBeOnTheScreen();
    expect(screen.getByText('Stop')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByText('Pause'));
    });
    expect(await screen.findByText('Resume')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });
    expect(await screen.findByText('Pause')).toBeOnTheScreen();
  });

  test('a resume the engine refuses is said in words, not mimed', async () => {
    await render(<TellingLead item={item} />);
    await act(async () => {
      fireEvent.press(await screen.findByText('Listen'));
    });
    await act(async () => {
      fireEvent.press(await screen.findByText('Pause'));
    });
    await screen.findByText('Resume');

    mockEngine.resumeRejects = true;
    await act(async () => {
      fireEvent.press(screen.getByText('Resume'));
    });

    // The same channel every engine failure takes, on the screen
    expect(await screen.findByText('Speech failed · retry')).toBeOnTheScreen();
    expect(screen.queryByText('Resume')).toBeNull();
    expect(screen.queryByText('Pause')).toBeNull();
  });
});
