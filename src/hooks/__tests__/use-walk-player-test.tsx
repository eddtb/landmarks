import { act, renderHook } from '@testing-library/react-native';

import { WalkStop } from '@/data/plan-store';
import { useWalkPlayer } from '@/hooks/use-walk-player';

jest.mock('@/utils/speech', () => ({
  speechAvailable: true,
  speakAsync: jest.fn(() => Promise.resolve('done')),
  stopSpeech: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/data/telling-client', () => ({
  fetchTelling: jest.fn((item: { title: string }) => Promise.resolve(`The telling of ${item.title}.`)),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { speakAsync } = require('@/utils/speech') as { speakAsync: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchTelling } = require('@/data/telling-client') as { fetchTelling: jest.Mock };

function walkStop(pageId: number, extract?: string): WalkStop {
  return {
    pageId,
    title: `Story ${pageId}`,
    coordinates: { latitude: 0, longitude: 0 },
    source: 'Wikipedia',
    extract,
  };
}

describe('useWalkPlayer', () => {
  beforeEach(() => {
    speakAsync.mockClear();
    fetchTelling.mockClear();
  });

  test('announces each stop in order, then tells the ones with source text', async () => {
    const stops = [walkStop(1, 'Built in 1443.'), walkStop(2), walkStop(3, 'Demolished in 1855.')];
    const { result } = await renderHook(() => useWalkPlayer(stops));

    await act(async () => {
      await result.current.play();
    });

    expect(speakAsync.mock.calls.map(([text]) => text)).toEqual([
      'Stop 1: Story 1.',
      'The telling of Story 1.',
      'Stop 2: Story 2.', // no extract: named, not told
      'Stop 3: Story 3.',
      'The telling of Story 3.',
    ]);
    expect(fetchTelling).toHaveBeenCalledTimes(2);
    expect(result.current.playingIndex).toBeNull(); // tour over
  });

  test('a failed telling skips the stop, not the tour', async () => {
    fetchTelling.mockRejectedValueOnce(new Error('offline'));
    const stops = [walkStop(1, 'Built in 1443.'), walkStop(2, 'Demolished in 1855.')];
    const { result } = await renderHook(() => useWalkPlayer(stops));

    await act(async () => {
      await result.current.play();
    });

    expect(speakAsync.mock.calls.map(([text]) => text)).toEqual([
      'Stop 1: Story 1.',
      'Stop 2: Story 2.',
      'The telling of Story 2.',
    ]);
  });

  test('a broken engine stops the tour honestly instead of miming it', async () => {
    speakAsync.mockResolvedValueOnce('error');
    const stops = [walkStop(1, 'Built in 1443.'), walkStop(2, 'Demolished in 1855.')];
    const { result } = await renderHook(() => useWalkPlayer(stops));

    await act(async () => {
      await result.current.play();
    });

    expect(speakAsync).toHaveBeenCalledTimes(1); // nothing after the failure
    expect(fetchTelling).not.toHaveBeenCalled();
    expect(result.current.playingIndex).toBeNull();
  });

  test('stop cancels the tour', async () => {
    const stops = [walkStop(1, 'Built in 1443.'), walkStop(2, 'Demolished in 1855.')];
    const { result } = await renderHook(() => useWalkPlayer(stops));

    // Cancel while the first title is being spoken
    speakAsync.mockImplementationOnce(async () => {
      await result.current.stop();
    });

    await act(async () => {
      await result.current.play();
    });

    expect(speakAsync.mock.calls.map(([text]) => text)).toEqual(['Stop 1: Story 1.']);
    expect(fetchTelling).not.toHaveBeenCalled();
    expect(result.current.playingIndex).toBeNull();
  });
});
