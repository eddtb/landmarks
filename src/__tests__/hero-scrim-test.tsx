/**
 * The hero scrim guarantees legibility over ANY photograph (#298).
 *
 * The flat 0.35 shade guaranteed nothing: over a bright sky it
 * composited to ~#A6A6A6, the white largeTitle read at 2.44:1, the
 * eyebrow at 2.44:1 against its 4.5:1 requirement, and the CC BY-SA
 * credit at 1.92:1 — content-dependent, so it passed every test and
 * failed on real skies. The widget solved this first
 * (src/widgets/area-stories.tsx): a four-stop gradient that keeps the
 * photograph bright where no text sits and takes the foot to 0.78+
 * where every line lives. The hero now wears the same recipe.
 */
import { act, cleanup, render, screen } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { Retold } from '@/types/retold';

const mockFetch = jest.fn();
jest.mock('expo/fetch', () => ({
  fetch: (...args: unknown[]) => mockFetch(...args),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { hostUri: 'localhost:8081' } },
}));

const credit = 'Photo: Alan Swain / Geograph (CC BY-SA)';

const article = {
  minutes: 6,
  images: [{ imageUrl: 'https://img/hero.jpg', credit }],
  chapters: [{ title: '', paragraphs: ['The old palace stood here.'] }],
};

const retold: Retold = {
  minutes: 7,
  brief: [],
  timeline: [],
  parts: [{ heading: 'One', body: 'Prose.' }],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch.mockImplementation(async (url: string) => {
    const path = String(url);
    if (path.includes('/api/retold')) {
      return { ok: true, status: 200, json: async () => ({ retold }) };
    }
    if (path.includes('/api/article')) {
      return { ok: true, status: 200, json: async () => ({ article }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
});

afterEach(async () => {
  cleanup();
  await act(async () => {});
});

async function paintHero() {
  await render(
    <AreaGazetteer
      areaName="Cutty Sark"
      relics={[]}
      allStories={[]}
      refreshing={false}
      onRefresh={() => {}}
    />
  );
  await screen.findByTestId('gazetteer-hero');
}

test('the scrim is the widget’s four-stop gradient, not a flat wash', async () => {
  await paintHero();

  const scrim = screen.getByTestId('hero-scrim');
  // The exact recipe: transparent at the top, 0.78 by the text zone,
  // 0.95 at the credit's foot — area-stories.tsx's stops, ported
  expect(scrim).toHaveStyle({
    experimental_backgroundImage:
      'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.35) 35%, rgba(0,0,0,0.78) 70%, rgba(0,0,0,0.95) 100%)',
  });
  // …and the flat wash that guaranteed nothing is gone
  expect(scrim).not.toHaveStyle({ backgroundColor: 'rgba(0,0,0,0.35)' });
});

test('no hero ink thins itself: the dim and the credit dropped their opacity', async () => {
  await paintHero();

  // 0.85 and 0.7 subtracted from a margin the scrim exists to
  // guarantee: white@0.7 over the old wash was 1.92:1 on a bright sky,
  // and the credit carries the CC BY-SA attribution
  const creditLine = screen.getByText(credit);
  expect(creditLine).not.toHaveStyle({ opacity: 0.7 });
  const meta = screen.getByText('1 parts · about 7 min · retold from Wikipedia');
  expect(meta).not.toHaveStyle({ opacity: 0.85 });
});
