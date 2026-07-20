import { useEffect, useRef, useState } from 'react';

import { WalkStop } from '@/data/plan-store';
import { fetchTelling } from '@/data/telling-client';
import { speakAsync, stopSpeech } from '@/utils/speech';

/**
 * Play the walk: each stop announced by name, then its telling —
 * an audio tour assembled from cached, free-tier narrations. The
 * loop lives in an event handler (user-initiated, cancellable), not
 * an effect.
 */
export function useWalkPlayer(stops: WalkStop[]) {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const cancelled = useRef(false);

  // Leaving the screen must silence the tour
  useEffect(() => {
    return () => {
      cancelled.current = true;
      void stopSpeech();
    };
  }, []);

  const stop = async () => {
    cancelled.current = true;
    setPlayingIndex(null);
    await stopSpeech();
  };

  const play = async () => {
    if (playingIndex !== null) {
      return;
    }
    cancelled.current = false;
    // The tour plays the walk as it stood at press — edits join next play
    const tour = stops;
    for (let index = 0; index < tour.length; index++) {
      if (cancelled.current) {
        return;
      }
      setPlayingIndex(index);
      const walkStop = tour[index];
      await speakAsync(`Stop ${index + 1}: ${walkStop.title}.`);
      if (cancelled.current) {
        return;
      }
      if (walkStop.extract) {
        try {
          const telling = await fetchTelling(walkStop);
          if (cancelled.current) {
            return;
          }
          await speakAsync(telling);
        } catch {
          // This stop keeps its silence; the next may still tell
        }
      }
    }
    if (!cancelled.current) {
      setPlayingIndex(null);
    }
  };

  return { playingIndex, play, stop };
}
