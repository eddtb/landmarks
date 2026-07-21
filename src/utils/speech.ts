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

export type SpeechOutcome = 'done' | 'stopped' | 'error' | 'unavailable';

/**
 * Resolves with what actually happened — never rejects. An engine
 * error used to resolve indistinguishably from success, which made a
 * broken device look like "nothing happened" (Edd's three reports of
 * silent Listen). Callers now get the truth to surface.
 */
export function speakAsync(text: string): Promise<SpeechOutcome> {
  return new Promise((resolve) => {
    if (!Speech) {
      resolve('unavailable');
      return;
    }
    Speech.speak(text, {
      onDone: () => resolve('done'),
      onStopped: () => resolve('stopped'),
      onError: () => resolve('error'),
    });
  });
}

export async function stopSpeech(): Promise<void> {
  await Speech?.stop();
}
