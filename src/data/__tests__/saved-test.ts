import AsyncStorage from '@react-native-async-storage/async-storage';

import { HistoryItem } from '@/types/history';

const item = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.48, longitude: 0 },
  distanceMeters: 100,
  extract: 'Some record.',
  url: 'https://en.wikipedia.org/wiki/x',
  source: 'Wikipedia',
});

// Seed "last session's" shelf BEFORE the module loads — the store
// hydrates at import, so this is the app relaunching (the
// history-client suite's own idiom).
const store = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
  .__INTERNAL_MOCK_STORAGE__;
store['cache-saved-places-v1'] = JSON.stringify([
  [
    'list',
    {
      value: [{ item: item(9001, 'Kept From Last Session'), savedAt: 1700000000000 }],
      // Ancient on purpose: the shelf never expires, so even an entry
      // written long ago must hydrate (Infinity TTL, prune-proof)
      at: 1700000000000,
    },
  ],
]);

const saved =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/data/saved') as typeof import('@/data/saved');

async function flushHydration() {
  // AsyncStorage's mock resolves in microtasks; a couple of turns lets
  // the module's hydration then-chain land
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('the saved shelf', () => {
  test('a relaunch keeps the shelf — even entries written long ago', async () => {
    await flushHydration();

    expect(saved.savedList()?.map((place) => place.item.title)).toEqual([
      'Kept From Last Session',
    ]);
    expect(saved.isSaved(9001)).toBe(true);
    expect(saved.savedItem(9001)?.title).toBe('Kept From Last Session');
  });

  test('a save lands newest-first; a second toggle removes exactly it', async () => {
    await flushHydration();

    saved.toggleSaved(item(42, 'Borough Compter'));
    expect(saved.savedList()?.map((place) => place.item.title)).toEqual([
      'Borough Compter',
      'Kept From Last Session',
    ]);

    saved.toggleSaved(item(42, 'Borough Compter'));
    expect(saved.isSaved(42)).toBe(false);
    expect(saved.savedList()?.map((place) => place.item.title)).toEqual([
      'Kept From Last Session',
    ]);
  });

  test('a toggle that races hydration is refused — it must never erase the shelf', () => {
    saved.setSavedForTests(null);

    saved.toggleSaved(item(43, 'Raced The Read'));

    expect(saved.savedList()).toBeNull();
    // The shelf recovers its real contents for the remaining tests
    saved.setSavedForTests([{ item: item(9001, 'Kept From Last Session'), savedAt: 1 }]);
  });

  test('the unknown story is simply not saved', () => {
    expect(saved.isSaved(31337)).toBe(false);
    expect(saved.savedItem(31337)).toBeUndefined();
  });
});
