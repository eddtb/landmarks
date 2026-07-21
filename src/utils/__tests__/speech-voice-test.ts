/**
 * The voice picker, held to account. Fixtures mirror real iOS voice
 * inventories — including Albert, the novelty voice that is somehow
 * worse than the robot, which alphabetical fallback once chose.
 */

type Voice = { identifier: string; language: string; quality: string };

function loadSpeech(voices: Voice[]) {
  jest.resetModules();
  const speak = jest.fn(
    (_text: string, options: { onDone: () => void; voice?: string; language?: string }) =>
      options.onDone()
  );
  jest.doMock('expo-speech', () => ({
    speak,
    stop: jest.fn(),
    getAvailableVoicesAsync: jest.fn(async () => voices),
  }));
  jest.doMock('expo-audio', () => ({ setAudioModeAsync: jest.fn(async () => {}) }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const speech = require('@/utils/speech') as typeof import('@/utils/speech');
  return { speech, speak };
}

const albert = { identifier: 'com.apple.eloquence.en-US.Albert', language: 'en-US', quality: 'Default' };
const compactGB = { identifier: 'com.apple.voice.compact.en-GB.Daniel', language: 'en-GB', quality: 'Default' };
const enhancedUS = { identifier: 'com.apple.voice.enhanced.en-US.Samantha', language: 'en-US', quality: 'Enhanced' };
const enhancedGB = { identifier: 'com.apple.voice.enhanced.en-GB.Serena', language: 'en-GB', quality: 'Enhanced' };

describe('the voice picker', () => {
  test('enhanced British wins outright', async () => {
    const { speech, speak } = loadSpeech([albert, compactGB, enhancedUS, enhancedGB]);
    await speech.speakAsync('hello');
    expect(speak.mock.calls[0][1].voice).toBe(enhancedGB.identifier);
    expect(speech.usingEnhancedVoice()).toBe(true);
  });

  test('any enhanced English beats the compact British robot', async () => {
    const { speech, speak } = loadSpeech([albert, compactGB, enhancedUS]);
    await speech.speakAsync('hello');
    expect(speak.mock.calls[0][1].voice).toBe(enhancedUS.identifier);
  });

  test('with nothing enhanced, choose NOTHING — never Albert', async () => {
    const { speech, speak } = loadSpeech([albert, compactGB]);
    await speech.speakAsync('hello');
    expect(speak.mock.calls[0][1].voice).toBeUndefined(); // system default speaks
    expect(speak.mock.calls[0][1].language).toBe('en-GB');
    expect(speech.usingEnhancedVoice()).toBe(false);
  });
});
