/**
 * The one guarded doorway to expo-speech. Native module: clients built
 * before it existed get silence, not a crash — callers check
 * `speechAvailable` when the difference matters to their UI.
 */

type SpeechModule = {
  speak: (
    text: string,
    options?: { onDone?: () => void; onStopped?: () => void; onError?: () => void }
  ) => void;
  stop: () => Promise<void>;
};

const Speech = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-speech') as SpeechModule;
  } catch {
    return null;
  }
})();

export const speechAvailable = Speech !== null;

// Apple's speech engine honours the RINGER SWITCH unless the app
// claims a playback audio session — the single most common cause of
// 'Listen does nothing, no error' (three reports before this line).
// Claimed once, lazily, before the first utterance.
let audioModeClaimed = false;
async function claimPlaybackAudio(): Promise<void> {
  if (audioModeClaimed) {
    return;
  }
  audioModeClaimed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio') as {
      setAudioModeAsync?: (mode: { playsInSilentMode: boolean }) => Promise<void>;
    };
    await audio.setAudioModeAsync?.({ playsInSilentMode: true });
  } catch {
    // Older builds without the module: speech still tries, ringer rules apply
  }
}

export type SpeechOutcome = 'done' | 'stopped' | 'error' | 'unavailable';

/**
 * Resolves with what actually happened — never rejects. An engine
 * error used to resolve indistinguishably from success, which made a
 * broken device look like "nothing happened" (Edd's three reports of
 * silent Listen). Callers now get the truth to surface.
 */
export async function speakAsync(text: string): Promise<SpeechOutcome> {
  if (!Speech) {
    return 'unavailable';
  }
  await claimPlaybackAudio();
  return new Promise((resolve) => {
    Speech!.speak(text, {
      onDone: () => resolve('done'),
      onStopped: () => resolve('stopped'),
      onError: () => resolve('error'),
    });
  });
}

export async function stopSpeech(): Promise<void> {
  await Speech?.stop();
}
