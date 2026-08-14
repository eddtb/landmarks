/**
 * Where the platform cannot pause, the word never renders.
 *
 * expo-speech's pause is iOS-only. The app ships iOS-only, but a
 * binary whose speech module lacks pause/resume must not be shown a
 * Pause that does nothing — the playing state keeps its single Stop,
 * exactly as it was before pause existed. A control that does nothing
 * is worse than no control.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TellingLead, TellingSection } from '@/components/telling-section';
import { HistoryItem } from '@/types/history';

type Handlers = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

const mockEngine: { handlers: Handlers | null } = { handlers: null };

// An engine with no pause API at all — the wrapperless worst case
jest.mock('expo-speech', () => ({
  speak: (_text: string, options: Handlers) => {
    mockEngine.handlers = options;
  },
  stop: async () => {
    mockEngine.handlers?.onStopped?.();
  },
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

describe('an engine that cannot pause', () => {
  test('TellingSection playing shows the single Stop — no Pause to betray', async () => {
    await render(<TellingSection item={item} />);
    await act(async () => {
      fireEvent.press(screen.getByText('Listen · about a minute'));
    });

    expect(await screen.findByText('Stop')).toBeOnTheScreen();
    expect(screen.queryByText('Pause')).toBeNull();
    expect(screen.queryByText('Resume')).toBeNull();
  });

  test('TellingLead playing shows the single Stop too', async () => {
    await render(<TellingLead item={item} />);
    await act(async () => {
      fireEvent.press(await screen.findByText('Listen'));
    });

    expect(await screen.findByText('Stop')).toBeOnTheScreen();
    expect(screen.queryByText('Pause')).toBeNull();
  });
});
