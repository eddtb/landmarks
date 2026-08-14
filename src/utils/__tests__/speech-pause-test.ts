/**
 * Pause and resume, held to what the engine can actually vouch for.
 *
 * expo-speech's native pause and resume both discard the Bool that
 * AVSpeechSynthesizer answers with, so their promises resolve the same
 * whether anything happened. These tests pin the honesty speech.ts
 * builds on top of that: the utterance ledger (nothing in flight,
 * nothing to pause), the isSpeaking probe after a resume, and the rule
 * that a resume which cannot resume settles the owner's
 * `await speakAsync(...)` with 'error' instead of miming success.
 */

type Handlers = {
  onDone?: () => void;
  onStopped?: () => void;
  onError?: () => void;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function loadSpeech({
  resumeRejects = false,
  heldAfterResume = true,
  pauseEndsUtterance = false,
  pauseApi = true,
}: {
  resumeRejects?: boolean;
  /** What the engine's isSpeaking answers after resume — false is the
   *  lock-screen aftermath: the paused utterance no longer exists. */
  heldAfterResume?: boolean;
  /** The race: the utterance finishes while the pause call is in flight. */
  pauseEndsUtterance?: boolean;
  pauseApi?: boolean;
} = {}) {
  jest.resetModules();
  let handlers: Handlers | null = null;
  const speak = jest.fn((_text: string, options: Handlers) => {
    handlers = options;
  });
  const stop = jest.fn(async () => {
    handlers?.onStopped?.();
  });
  const pause = jest.fn(async () => {
    if (pauseEndsUtterance) {
      handlers?.onDone?.();
    }
  });
  const resume = jest.fn(async () => {
    if (resumeRejects) {
      throw new Error('the synthesizer refused');
    }
  });
  const isSpeakingAsync = jest.fn(async () => heldAfterResume);
  const module: Record<string, unknown> = {
    speak,
    stop,
    isSpeakingAsync,
    getAvailableVoicesAsync: jest.fn(async () => []),
  };
  if (pauseApi) {
    module.pause = pause;
    module.resume = resume;
  }
  jest.doMock('expo-speech', () => module);
  jest.doMock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}) }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const speech = require('@/utils/speech') as typeof import('@/utils/speech');
  return {
    speech,
    speak,
    stop,
    pause,
    resume,
    finish: () => handlers?.onDone?.(),
  };
}

describe('the pause/resume state machine', () => {
  test('pause while speaking: paused, and the utterance await holds', async () => {
    const { speech, pause } = loadSpeech();
    const utterance = speech.speakAsync('hello');
    await flush();

    expect(await speech.pauseSpeech()).toBe('paused');
    expect(pause).toHaveBeenCalledTimes(1);

    // The owner's await is still pending — a pause is not an ending
    const settled = jest.fn();
    void utterance.then(settled);
    await flush();
    expect(settled).not.toHaveBeenCalled();
  });

  test('resume after pause: speaking again, and the utterance still finishes as done', async () => {
    const { speech, resume, finish } = loadSpeech();
    const utterance = speech.speakAsync('hello');
    await flush();
    await speech.pauseSpeech();

    expect(await speech.resumeSpeech()).toBe('speaking');
    expect(resume).toHaveBeenCalledTimes(1);

    finish();
    expect(await utterance).toBe('done');
  });

  test('stop from paused settles the utterance as stopped', async () => {
    const { speech, stop } = loadSpeech();
    const utterance = speech.speakAsync('hello');
    await flush();
    await speech.pauseSpeech();

    await speech.stopSpeech();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(await utterance).toBe('stopped');
  });

  test('pause with nothing in flight refuses without touching the engine', async () => {
    const { speech, pause } = loadSpeech();
    expect(await speech.pauseSpeech()).toBe('error');
    expect(pause).not.toHaveBeenCalled();
  });

  test('resume with nothing paused refuses too', async () => {
    const { speech, resume } = loadSpeech();
    expect(await speech.resumeSpeech()).toBe('error');
    expect(resume).not.toHaveBeenCalled();
  });

  test('a pause that lands as the utterance ends refuses — no Resume over silence', async () => {
    const { speech } = loadSpeech({ pauseEndsUtterance: true });
    const utterance = speech.speakAsync('hello');
    await flush();

    expect(await speech.pauseSpeech()).toBe('error');
    expect(await utterance).toBe('done');
  });

  test('a resume the engine rejects settles the owner’s await with error', async () => {
    const { speech } = loadSpeech({ resumeRejects: true });
    const utterance = speech.speakAsync('hello');
    await flush();
    await speech.pauseSpeech();

    expect(await speech.resumeSpeech()).toBe('error');
    // The honesty headline: the failure reaches whoever is awaiting the
    // utterance, down the same channel every engine failure takes
    expect(await utterance).toBe('error');
  });

  test('a resume the engine no longer holds surfaces, and the deck is cleared', async () => {
    // The lock-screen aftermath: playback dies with the screen
    // (enableBackgroundPlayback is false), resume resolves void, and
    // only the isSpeaking probe knows there is nothing left to speak
    const { speech, stop } = loadSpeech({ heldAfterResume: false });
    const utterance = speech.speakAsync('hello');
    await flush();
    await speech.pauseSpeech();

    expect(await speech.resumeSpeech()).toBe('error');
    expect(await utterance).toBe('error');
    await flush();
    expect(stop).toHaveBeenCalled();
  });

  test('without a pause API the gate is closed before any word renders', async () => {
    const { speech } = loadSpeech({ pauseApi: false });
    expect(speech.speechCanPause).toBe(false);

    const utterance = speech.speakAsync('hello');
    await flush();
    expect(await speech.pauseSpeech()).toBe('error');
    expect(await speech.resumeSpeech()).toBe('error');

    await speech.stopSpeech();
    expect(await utterance).toBe('stopped');
  });
});
