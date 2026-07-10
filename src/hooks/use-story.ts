import { useEffect, useState } from 'react';

import { fetchStory, Story } from '@/data/story-client';
import { Place } from '@/types/place';

export type StoryState =
  | { status: 'loading' }
  | { status: 'none' }
  | { status: 'ready'; story: Story };

/**
 * Resolves the Story section for a place: places that already carry a
 * story (demo data) use it directly; otherwise Wikipedia is consulted
 * once per place per session. "No story" is a normal outcome.
 */
export function useStory(place: Place | undefined): StoryState {
  const hasOwnStory = !!place?.story;
  const [state, setState] = useState<StoryState>(
    hasOwnStory ? { status: 'none' } : { status: 'loading' }
  );

  useEffect(() => {
    if (!place || hasOwnStory) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const story = await fetchStory(place);
        if (!cancelled) {
          setState(story ? { status: 'ready', story } : { status: 'none' });
        }
      } catch (error) {
        console.warn('Failed to load story:', error);
        if (!cancelled) {
          setState({ status: 'none' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [place, hasOwnStory]);

  if (hasOwnStory && place?.story) {
    return { status: 'ready', story: { story: place.story, title: place.name, url: '' } };
  }
  return state;
}
