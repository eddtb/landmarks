import AsyncStorage from '@react-native-async-storage/async-storage';

import { Article } from '@/types/article';
import { Retold } from '@/types/retold';

const article: Article = {
  chapters: [{ title: '', paragraphs: ['Built in 1717.'] }],
  minutes: 4,
  images: [],
};

const retold: Retold = {
  parts: [{ heading: 'One', body: 'First.' }],
  minutes: 1,
  timeline: [],
  brief: [],
};

// Seed "last session's" downloads BEFORE the module loads — hydration
// at import is the relaunch (the shelf suite's own idiom). Ancient
// `at` on purpose: the pack never expires.
const store = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
  .__INTERNAL_MOCK_STORAGE__;
store['cache-offline-pack-v1'] = JSON.stringify([
  [
    'pack',
    {
      value: {
        enabled: true,
        stories: { 'palace of placentia': { article, retold } },
        tellings: { '42': 'A short telling from last session.' },
      },
      at: 1700000000000,
    },
  ],
]);

const pack =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@/data/offline-pack') as typeof import('@/data/offline-pack');

async function flushHydration() {
  await pack.packHydrated;
}

describe('the offline pack', () => {
  test('a relaunch keeps the downloads and the toggle — even written long ago', async () => {
    await flushHydration();

    expect(pack.keepOfflineEnabled()).toBe(true);
    expect(pack.packStory('Palace of Placentia')?.retold?.parts[0].heading).toBe('One');
    expect(pack.packTelling(42)).toBe('A short telling from last session.');
  });

  test('story keys are the screens’ own, case-blind like the retold client', async () => {
    await flushHydration();

    pack.writePackStory('Spanish Galleon', { article, retold: null });

    expect(pack.packStory('spanish galleon')?.article?.minutes).toBe(4);
    // A null retold is the remembered "under the gate" verdict, kept as data
    expect(pack.packStory('SPANISH GALLEON')?.retold).toBeNull();
  });

  test('retain keeps only what the shelf still holds', async () => {
    await flushHydration();

    pack.retainPackEntries(['Palace of Placentia'], [42]);
    expect(pack.packStory('Spanish Galleon')).toBeUndefined();
    expect(pack.packStory('Palace of Placentia')).toBeDefined();
    expect(pack.packTelling(42)).toBeDefined();

    pack.retainPackEntries([], []);
    expect(pack.packStory('Palace of Placentia')).toBeUndefined();
    expect(pack.packTelling(42)).toBeUndefined();
  });

  test('toggle-off is a purge: downloads go, the flag goes, nothing lingers', async () => {
    await flushHydration();

    pack.writePackStory('Borough Compter', { article, retold });
    pack.writePackTelling(7, 'Kept words.');
    pack.setKeepOffline(false);

    expect(pack.keepOfflineEnabled()).toBe(false);
    expect(pack.packStory('Borough Compter')).toBeUndefined();
    expect(pack.packTelling(7)).toBeUndefined();
  });
});
