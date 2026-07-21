/**
 * The one guarded doorway to expo-speech. Native module: clients built
 * before it existed get silence, not a crash — callers check
 * `speechAvailable` when the difference matters to their UI.
 */

type SpeechVoice = { identifier: string; language?: string; quality?: string };
type SpeechModule = {
  speak: (
    text: string,
    options?: {
      voice?: string;
      language?: string;
      onDone?: () => void;
      onStopped?: () => void;
      onError?: () => void;
    }
  ) => void;
  stop: () => Promise<void>;
  getAvailableVoicesAsync?: () => Promise<SpeechVoice[]>;
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
// The engine's DEFAULT voice is the robotic compact one; devices carry
// better. Prefer enhanced-quality British English, then any British,
// then any English — chosen once per session. (The truly beautiful
// voices appear here automatically once downloaded in iOS Settings →
// Accessibility → Spoken Content → Voices.)
let chosenVoice: string | null | undefined;
async function bestVoice(): Promise<string | null> {
  if (chosenVoice !== undefined) {
    return chosenVoice;
  }
  try {
    const voices = (await Speech?.getAvailableVoicesAsync?.()) ?? [];
    const british = voices.filter((voice) => voice.language?.startsWith('en-GB'));
    const english = british.length
      ? british
      : voices.filter((voice) => voice.language?.startsWith('en'));
    const enhanced = english.find((voice) => /enhanced|premium/i.test(voice.quality ?? ''));
    chosenVoice = (enhanced ?? english[0])?.identifier ?? null;
  } catch {
    chosenVoice = null;
  }
  return chosenVoice;
}

export async function speakAsync(text: string): Promise<SpeechOutcome> {
  if (!Speech) {
    return 'unavailable';
  }
  await claimPlaybackAudio();
  const voice = await bestVoice();
  return new Promise((resolve) => {
    Speech!.speak(text, {
      voice: voice ?? undefined,
      language: 'en-GB',
      onDone: () => resolve('done'),
      onStopped: () => resolve('stopped'),
      onError: () => resolve('error'),
    });
  });
}

export async function stopSpeech(): Promise<void> {
  await Speech?.stop();
}
