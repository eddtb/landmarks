import { useEffect, useSyncExternalStore } from 'react';

import { WalkStop } from '@/data/plan-store';
import { fetchTelling } from '@/data/telling-client';
import { speakAsync, stopSpeech } from '@/utils/speech';

/**
 * Play the walk: each stop announced by name, then its telling — an
 * audio tour assembled from cached, free-tier narrations. ONE player
 * for the whole app: the walk bar and the builder screen both mount
 * this hook, and there is only one mouth — module state keeps them
 * from talking over each other.
 */

let playingIndex: number | null = null;
let cancelled = false;
const listeners = new Set<() => void>();

function setPlayingIndex(index: number | null) {
  playingIndex = index;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getPlayingIndex(): number | null {
  return playingIndex;
}

async function stopTour() {
  cancelled = true;
  setPlayingIndex(null);
  await stopSpeech();
}

async function playTour(stops: WalkStop[]) {
  if (playingIndex !== null) {
    return;
  }
  cancelled = false;
  // The tour plays the walk as it stood at press — edits join next play
  const tour = stops;
  for (let index = 0; index < tour.length; index++) {
    if (cancelled) {
      return;
    }
    setPlayingIndex(index);
    const walkStop = tour[index];
    const outcome = await speakAsync(`Stop ${index + 1}: ${walkStop.title}.`);
    if (outcome === 'error') {
      // A broken engine makes a silent tour — stop honestly
      setPlayingIndex(null);
      return;
    }
    if (cancelled) {
      return;
    }
    if (walkStop.extract) {
      try {
        const telling = await fetchTelling(walkStop);
        if (cancelled) {
          return;
        }
        await speakAsync(telling);
      } catch {
        // This stop keeps its silence; the next may still tell
      }
    }
  }
  if (!cancelled) {
    setPlayingIndex(null);
  }
}

export function useWalkPlayer(stops: WalkStop[]) {
  const index = useSyncExternalStore(subscribe, getPlayingIndex, getPlayingIndex);

  // The tour outlives any one screen, but not the whole app being
  // backgrounded/unmounted — no per-mount silencing (the bar and the
  // builder mount and unmount around a playing tour by design)
  useEffect(() => {
    return () => {
      // Last listener gone (app-level teardown): silence the tour
      if (listeners.size === 0) {
        void stopTour();
      }
    };
  }, []);

  return {
    playingIndex: index,
    play: () => playTour(stops),
    stop: stopTour,
  };
}
