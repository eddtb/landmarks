import { fetchStory } from '@/data/story-client';
import { MockPlaces } from '@/data/mock-places';

const mockFetch = jest.fn();

jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const wikiStory = {
  story: 'A bridge with a story.',
  title: 'Tower Bridge',
  url: 'https://en.wikipedia.org/wiki/Tower_Bridge',
};

describe('fetchStory', () => {
  beforeEach(() => mockFetch.mockReset());

  test('requests /api/story with name and coordinates', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => wikiStory });

    const story = await fetchStory(MockPlaces[0]);

    const requested = mockFetch.mock.calls[0][0] as string;
    expect(requested).toContain('/api/story?');
    expect(requested).toContain('name=Tower+Bridge');
    expect(story?.title).toBe('Tower Bridge');
  });

  test('caches per place — including the no-story outcome', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ story: null }) });

    const first = await fetchStory(MockPlaces[1]);
    const second = await fetchStory(MockPlaces[1]);

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
