/**
 * The glass chrome, both branches (#300).
 *
 * Glass ships in a BINARY and only on iOS 26, so most binaries render
 * the fallback — which is why every surface here is asserted twice,
 * once with the native module present and once without. The suite's own
 * default is absent (jest-setup mocks `isLiquidGlassAvailable` false),
 * so a test that only ever exercised the mock would be testing the
 * minority case and calling it coverage.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { AreaGazetteer } from '@/components/area-gazetteer';
import { HistoryCard } from '@/components/history-card';
import { Glass } from '@/constants/theme';
import { HistoryItem } from '@/types/history';

// This file's own glass mock, with a switch on it. jest-setup's is
// hard-wired to false; the whole point here is to render both.
const mockGlassOn = { value: false };
jest.mock(
  'expo-glass-effect',
  () => {
    const React = jest.requireActual('react');
    const { View } = jest.requireActual('react-native');
    return {
      // The real GlassView draws a native material and takes no
      // backgroundColor of ours — so does this, which is what lets a
      // test tell "the material is native" from "we painted a scrim".
      GlassView: ({ children, style, testID }: Record<string, unknown>) =>
        React.createElement(View, { style, testID }, children as never),
      // Guarded: jest hoists this factory above the flag, and
      // expo-router's native stack asks this question at MODULE scope
      // while requireActual runs — before the flag exists. Absent is
      // the right answer then, and it is the suite's default anyway.
      isLiquidGlassAvailable: () => Boolean(mockGlassOn?.value),
    };
  },
  { virtual: true }
);

const mockScheme = jest.fn(() => 'light');
jest.mock('@/hooks/use-color-scheme', () => ({
  useColorScheme: () => mockScheme(),
}));

/**
 * A REAL notch. The suite-wide safe-area mock returns zeros, which
 * makes every inset arithmetic in this feature look identical — the
 * full-bleed hero, the island's own top, the title block's clearance
 * all collapse to the same number and nothing can be told apart. 59 is
 * the iPhone status inset the mock frames are drawn at.
 */
const StatusInset = 59;
jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context/jest/mock').default;
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
  };
});

// Spread the real module: the gazetteer's citation row renders
// expo-router's Link, and a bare stub takes the whole list down with it
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return { ...actual, router: { ...actual.router, push: jest.fn(), back: jest.fn() } };
});

const mockFetchArticle = jest.fn();
jest.mock('@/data/article-client', () => ({
  fetchArticle: (...args: unknown[]) => mockFetchArticle(...args),
  fetchArticleLight: jest.fn(async () => null),
}));

const mockFetchRetold = jest.fn();
jest.mock('@/data/retold-client', () => ({
  fetchRetold: (...args: unknown[]) => mockFetchRetold(...args),
}));

jest.mock('@/data/journal', () => ({
  useJournalEntry: () => ({ readAt: 1, visitedAt: null }),
  markRead: jest.fn(),
  markVisited: jest.fn(),
}));

const relic = (pageId: number, title: string): HistoryItem => ({
  pageId,
  title,
  coordinates: { latitude: 51.4826, longitude: -0.0077 },
  distanceMeters: 120,
  extract: `The story of ${title}.`,
  url: `https://en.wikipedia.org/wiki/${title}`,
  source: 'Wikipedia',
  pastTag: 'No longer standing',
});

const relics = [relic(1, 'Palace of Placentia'), relic(2, 'Greenwich Hospital')];

/** The tab: the gazetteer with no `chrome`, which is what makes it the
 *  story screen minus the chevron. */
function tab() {
  return (
    <AreaGazetteer
      areaName="Greenwich"
      areaLabel="Greenwich"
      relics={relics}
      allStories={relics}
      refreshing={false}
      onRefresh={jest.fn()}
    />
  );
}

/** Scroll the gazetteer past the hero — the island's whole trigger. */
async function scrollPastHero(y = 600) {
  await act(async () => {
    fireEvent.scroll(screen.getByTestId('gazetteer-list'), {
      nativeEvent: {
        contentOffset: { y },
        contentSize: { height: 4000, width: 390 },
        layoutMeasurement: { height: 800, width: 390 },
      },
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGlassOn.value = false;
  mockScheme.mockReturnValue('light');
  mockFetchArticle.mockResolvedValue({ minutes: 3, images: [], chapters: [] });
  mockFetchRetold.mockResolvedValue(null);
});

/* ------------------------------------------------------------------ */

describe('the island arrives where a title has left', () => {
  test('an UN-RETOLD area gets chrome — the gate is the hero, not the AI', async () => {
    // The bug this fences: `islandShown && retold` meant an area
    // Wikipedia never retold scrolled forever with no chrome and no
    // title. Not "arrives late" — never.
    mockFetchRetold.mockResolvedValue(null);
    await render(tab());
    await screen.findByTestId('gazetteer-hero');

    // At rest the hero is the title, so nothing repeats it
    expect(screen.queryByTestId('gazetteer-island')).toBeNull();

    await scrollPastHero();

    expect(screen.getByTestId('gazetteer-island')).toBeOnTheScreen();
    expect(screen.getByText('The story of Greenwich')).toBeOnTheScreen();
  });

  test('the counter counts relics when there is no telling to count', async () => {
    mockFetchRetold.mockResolvedValue(null);
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    // The History tab's missing count line, landed (DESIGN.md asks for
    // one; the tab never had one at all)
    expect(screen.getByTestId('island-counter')).toHaveTextContent('2 relics');
  });

  test('…and counts PARTS while the reader is in them', async () => {
    mockFetchRetold.mockResolvedValue({
      minutes: 2,
      brief: [],
      timeline: [],
      parts: [
        { heading: 'Birthplace of Kings', body: 'Henry VIII was born here in 1491.' },
        { heading: 'The palace goes', body: 'Placentia stood two centuries, then went.' },
        { heading: 'The hospital rises', body: 'Wren built over its footprint.' },
      ],
    });
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    expect(screen.getByTestId('island-counter')).toHaveTextContent('1 / 3');
  });

  test('the tab island carries no chevron — the tab pill is its navigation', async () => {
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    expect(screen.getByTestId('gazetteer-island')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-back')).toBeNull();
  });

  test('arrival is a THRESHOLD: back above it, the chrome unmounts again', async () => {
    // Not a fade — animating opacity over a GlassView disables the
    // glass, so the island mounts and unmounts on the crossing.
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();
    expect(screen.getByTestId('gazetteer-island')).toBeOnTheScreen();

    await scrollPastHero(0);
    expect(screen.queryByTestId('gazetteer-island')).toBeNull();
  });
});

/* ------------------------------------------------------------------ */

describe('the material follows what it sits on — in BOTH branches', () => {
  test('no glass: the island is translucent, never an opaque slab', async () => {
    mockGlassOn.value = false;
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    // The rejected material (ded231b) is an opaque theme.background
    expect(screen.getByTestId('glass-island').children.length).toBeGreaterThan(0);
    const island = screen.getByTestId('gazetteer-island').parent;
    expect(island).toHaveStyle({ backgroundColor: Glass.page.light.fill });
    expect(island).not.toHaveStyle({ backgroundColor: '#FFFFFF' });
  });

  test('no glass, dark: the island takes the dark scheme’s translucency', async () => {
    mockGlassOn.value = false;
    mockScheme.mockReturnValue('dark');
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    expect(screen.getByTestId('gazetteer-island').parent).toHaveStyle({
      backgroundColor: Glass.page.dark.fill,
    });
  });

  test('real glass: the island paints NO scrim of ours — the material is native', async () => {
    mockGlassOn.value = true;
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    const island = screen.getByTestId('gazetteer-island').parent;
    expect(island).not.toHaveStyle({ backgroundColor: Glass.page.light.fill });
    expect(island).not.toHaveStyle({ backgroundColor: Glass.page.dark.fill });
  });

  test('no glass: the read tick is THE chip, at the label’s lighter weight', async () => {
    mockGlassOn.value = false;
    await render(<HistoryCard item={{ ...relic(9, 'Cutty Sark'), thumbnailUrl: 'x.jpg' }} />);

    // It used to hand-roll its own pill from its own grey, which made
    // it the one chip in the app that never got real glass on iOS 26
    expect(screen.getByTestId('read-tick')).toHaveStyle({
      backgroundColor: Glass.photo.labelScrim,
    });
    expect(screen.getByText(/Read/)).toHaveStyle({ color: '#FFFFFF' });
  });

  test('real glass: the read tick finally GETS it', async () => {
    mockGlassOn.value = true;
    await render(<HistoryCard item={{ ...relic(9, 'Cutty Sark'), thumbnailUrl: 'x.jpg' }} />);

    expect(screen.getByTestId('read-tick')).not.toHaveStyle({
      backgroundColor: Glass.photo.labelScrim,
    });
    // …and still says its word, which is the mark's whole point
    expect(screen.getByText(/Read/)).toBeOnTheScreen();
  });
});

/* ------------------------------------------------------------------ */

describe('one chip, two renderings', () => {
  test('over a photo the chip pins dark under a white glyph; on the page it follows the theme', async () => {
    mockGlassOn.value = false;
    const onBack = jest.fn();
    await render(
      <AreaGazetteer
        areaName="Greenwich"
        relics={relics}
        allStories={relics}
        refreshing={false}
        onRefresh={jest.fn()}
        chrome={{ backLabel: 'Stories', onBack }}
      />
    );
    await screen.findByTestId('gazetteer-hero');

    expect(screen.getByTestId('back-chip')).toHaveStyle({
      backgroundColor: Glass.photo.glyphScrim,
    });
    expect(screen.getByText('‹')).toHaveStyle({ color: '#FFFFFF' });

    // …and it is a real way out, in every state
    fireEvent.press(screen.getByTestId('story-back'));
    expect(onBack).toHaveBeenCalled();
  });

  test('with no article there is no photograph, so the chip takes the page', async () => {
    mockGlassOn.value = false;
    mockFetchArticle.mockResolvedValue(null);
    await render(
      <AreaGazetteer
        areaName="Greenwich"
        relics={relics}
        allStories={relics}
        refreshing={false}
        onRefresh={jest.fn()}
        chrome={{ backLabel: 'Stories', onBack: jest.fn() }}
      />
    );
    await screen.findByTestId('gazetteer-title');

    expect(screen.getByTestId('back-chip')).toHaveStyle({
      backgroundColor: Glass.page.light.fill,
    });
    expect(screen.getByText('‹')).not.toHaveStyle({ color: '#FFFFFF' });
  });
});

/* ------------------------------------------------------------------ */

describe('the tab keeps its magazine cover', () => {
  test('the hero runs to the TRUE screen top, grown by the status inset', async () => {
    // Direction B: History keeps its full-bleed hero. It used to grow
    // by the inset only on the story screen (`chrome ? insets.top : 0`),
    // so on the tab the cover started below the notch and was not
    // full-bleed at all. The visible frame stays 220pt either way —
    // that is what growing by the inset buys.
    await render(tab());

    expect(await screen.findByTestId('gazetteer-hero')).toHaveStyle({
      height: 220 + StatusInset,
    });
  });

  test('the island anchors at the notch, not at zero', async () => {
    await render(tab());
    await screen.findByTestId('gazetteer-hero');
    await scrollPastHero();

    // It used to pass topOffset={0} because a SafeAreaView above it had
    // already paid the notch — one of the three origins (#300, item 6)
    expect(screen.getByTestId('glass-island')).toHaveStyle({ top: StatusInset });
  });

  test('with no article the title block clears the notch itself', async () => {
    mockFetchArticle.mockResolvedValue(null);
    await render(tab());

    expect(await screen.findByTestId('gazetteer-title')).toHaveStyle({
      paddingTop: StatusInset + 16,
    });
  });
});

/* ------------------------------------------------------------------ */

describe('the fallback has an edge on Android too', () => {
  test('a chip over a pale photo carries elevation, not just a hairline', async () => {
    // The island fallback had `elevation: 4`; the chip fallback had
    // none, and Android draws no shadow without it — so a chip over a
    // bright photograph had nothing but a hairline holding it off.
    mockGlassOn.value = false;
    await render(<HistoryCard item={{ ...relic(9, 'Cutty Sark'), thumbnailUrl: 'x.jpg' }} />);

    expect(screen.getByTestId('read-tick')).toHaveStyle({ elevation: 4 });
  });
});

/* ------------------------------------------------------------------ */

describe('a located reader is always told where they are (#292 survives)', () => {
  test('an area with no article gets its name on the page, not nowhere', async () => {
    // The standing header direction B removed was #292's answer to
    // this. The title block is the new one — and it is the thing the
    // island later arrives to carry.
    mockFetchArticle.mockResolvedValue(null);
    await render(tab());

    expect(await screen.findByTestId('gazetteer-title')).toBeOnTheScreen();
    expect(screen.getByText('Greenwich')).toBeOnTheScreen();
  });
});
