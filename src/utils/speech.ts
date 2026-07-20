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

/** Resolves when the utterance finishes, is stopped, or errors — never rejects. */
export function speakAsync(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!Speech) {
      resolve();
      return;
    }
    Speech.speak(text, {
      onDone: () => resolve(),
      onStopped: () => resolve(),
      onError: () => resolve(),
    });
  });
}

export async function stopSpeech(): Promise<void> {
  await Speech?.stop();
}
