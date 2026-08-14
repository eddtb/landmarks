/**
 * The one guarded doorway to expo-speech. Native module: clients built
 * before it existed get silence, not a crash — callers check
 * `speechAvailable` when the difference matters to their UI.
 */

import { Platform } from 'react-native';

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
  pause?: () => Promise<void>;
  resume?: () => Promise<void>;
  isSpeakingAsync?: () => Promise<boolean>;
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

/**
 * Pause is iOS-only in expo-speech — Android's wrapper exports the
 * function and throws at call time. The app ships iOS-only, but the
 * word must never render on a platform that cannot honour it: a
 * control that does nothing is worse than no control. Callers gate the
 * Pause/Resume words on this and fall back to the single Stop.
 */
export const speechCanPause =
  speechAvailable &&
  Platform.OS === 'ios' &&
  typeof Speech?.pause === 'function' &&
  typeof Speech?.resume === 'function';

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
let chosenVoiceEnhanced = false;

/** Whether the session's voice is one of the good ones. */
export function usingEnhancedVoice(): boolean {
  return chosenVoiceEnhanced;
}

async function bestVoice(): Promise<string | null> {
  if (chosenVoice !== undefined) {
    return chosenVoice;
  }
  try {
    const voices = (await Speech?.getAvailableVoicesAsync?.()) ?? [];
    const english = voices.filter((voice) => voice.language?.startsWith('en'));
    const isEnhanced = (voice: SpeechVoice) => /enhanced|premium/i.test(voice.quality ?? '');
    // ANY enhanced English beats the compact British robot — but with
    // no enhanced voice installed, choose NOTHING and let the system
    // default speak: 'first English voice alphabetically' is Albert
    // the novelty voice, somehow worse than the robot
    const picked =
      english.find((voice) => voice.language?.startsWith('en-GB') && isEnhanced(voice)) ??
      english.find(isEnhanced);
    chosenVoice = picked?.identifier ?? null;
    chosenVoiceEnhanced = picked !== undefined;
    console.log(
      `[voice] ${english.length} English voices, ${english.filter(isEnhanced).length} enhanced; ` +
        `using ${picked?.identifier ?? 'system default (en-GB)'}`
    );
  } catch {
    chosenVoice = null;
  }
  return chosenVoice;
}

// The utterance in flight, held by its resolver. Pause and resume need
// it twice over: to refuse when there is nothing to pause, and to make
// a broken resume settle the owner's `await speakAsync(...)` with
// 'error' instead of leaving it pending over a dead engine.
let settleUtterance: ((outcome: SpeechOutcome) => void) | null = null;

// A fresh read each call — the settle handlers clear the ledger from
// inside awaited native calls, a movement narrowing cannot follow
function utteranceInFlight(): boolean {
  return settleUtterance !== null;
}

export async function speakAsync(text: string): Promise<SpeechOutcome> {
  if (!Speech) {
    return 'unavailable';
  }
  await claimPlaybackAudio();
  const voice = await bestVoice();
  return new Promise((resolve) => {
    function settle(outcome: SpeechOutcome) {
      if (settleUtterance === settle) {
        settleUtterance = null;
      }
      resolve(outcome);
    }
    settleUtterance = settle;
    Speech!.speak(text, {
      voice: voice ?? undefined,
      language: 'en-GB',
      onDone: () => settle('done'),
      onStopped: () => settle('stopped'),
      onError: () => settle('error'),
    });
  });
}

export async function stopSpeech(): Promise<void> {
  await Speech?.stop();
}

export type PauseOutcome = 'paused' | 'error';
export type ResumeOutcome = 'speaking' | 'error';

/**
 * Both native calls answer an AVSpeechSynthesizer Bool that expo-speech
 * throws away, so a pause or resume that did nothing resolves exactly
 * like one that worked. These two surface what CAN be observed — the
 * utterance ledger above, a thrown call, the engine's own isSpeaking —
 * and refuse to report a state they cannot vouch for.
 */
export async function pauseSpeech(): Promise<PauseOutcome> {
  if (!speechCanPause || !Speech?.pause || !settleUtterance) {
    return 'error';
  }
  try {
    await Speech.pause();
  } catch {
    return 'error';
  }
  // The utterance may have finished while the call was in flight —
  // native pause "succeeds" against silence, and a Resume word with
  // nothing to resume is a trap.
  return utteranceInFlight() ? 'paused' : 'error';
}

export async function resumeSpeech(): Promise<ResumeOutcome> {
  const settle = settleUtterance;
  if (!speechCanPause || !Speech?.resume || !settle) {
    return 'error';
  }
  try {
    await Speech.resume();
  } catch {
    settleAsEngineFailure(settle);
    return 'error';
  }
  // The one observable truth after a void resume: isSpeaking is true
  // for a speaking OR paused utterance, false only when none exists —
  // which is what a screen lock leaves behind (playback ends with the
  // binary's enableBackgroundPlayback: false). A paused synthesizer
  // that failed to resume must surface, not pretend.
  if (!(await stillHeldByEngine())) {
    settleAsEngineFailure(settle);
    return 'error';
  }
  return 'speaking';
}

async function stillHeldByEngine(): Promise<boolean> {
  try {
    return (await Speech?.isSpeakingAsync?.()) ?? true;
  } catch {
    // No probe, no verdict — never fail a resume on a missing thermometer
    return true;
  }
}

function settleAsEngineFailure(settle: (outcome: SpeechOutcome) => void) {
  // Route the failure down the channel every engine failure takes: the
  // owner's await resolves 'error' and its UI says so. Then clear
  // whatever the engine still holds so the next Listen starts clean —
  // a late onStopped finds the utterance already settled and is a no-op.
  settle('error');
  void stopSpeech().catch(() => {});
}
