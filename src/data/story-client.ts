import { fetch } from 'expo/fetch';

import { apiUrl } from '@/data/places-client';
import { Place } from '@/types/place';

export type Story = {
  story: string;
  title: string;
  url: string;
};

// One lookup per place per session — a place's history doesn't change
// while the app is open. `null` (no article) is cached too.
const storyCache = new Map<string, Story | null>();

export async function fetchStory(place: Place): Promise<Story | null> {
  const cached = storyCache.get(place.id);
  if (cached !== undefined) {
    return cached;
  }

  const params = new URLSearchParams({
    name: place.name,
    lat: String(place.coordinates.latitude),
    lng: String(place.coordinates.longitude),
  });

  const response = await fetch(apiUrl(`/api/story?${params}`));
  if (!response.ok) {
    throw new Error(`Story request failed with status ${response.status}`);
  }

  const body = (await response.json()) as { story: string | null; title?: string; url?: string };
  const story =
    body.story && body.title && body.url
      ? { story: body.story, title: body.title, url: body.url }
      : null;

  storyCache.set(place.id, story);
  return story;
}
