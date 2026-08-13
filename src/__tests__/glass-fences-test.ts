/**
 * Fences for the CLASS of bug, not the instances (#300).
 *
 * Seven one-off chrome implementations were catalogued on this branch,
 * and five of them were the same mistake made in a new file: a surface
 * drew its own glass because nothing stopped it. Rendering tests catch
 * the instance you thought of. These catch the next one.
 *
 * They read source, which is the only place the class is visible — a
 * component that hand-rolls a chip renders perfectly well.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SrcRoot = join(__dirname, '..');

/** Every hand-written source file in src/, excluding the tests. */
function sourceFiles(): { path: string; text: string }[] {
  const found: { path: string; text: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
          walk(full);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push({ path: full.slice(SrcRoot.length + 1), text: readFileSync(full, 'utf8') });
      }
    }
  };
  walk(SrcRoot);
  return found;
}

const files = sourceFiles();
const file = (path: string) => {
  const found = files.find((candidate) => candidate.path === path);
  if (!found) {
    throw new Error(`fence is pointed at a file that no longer exists: ${path}`);
  }
  return found.text;
};

const GlassHeader = 'components/glass-header.tsx';
const Theme = 'constants/theme.ts';

describe('the fence guards a real wall', () => {
  test('the files these fences name are actually there', () => {
    // A fence that silently stops fencing is worse than none (#312):
    // every path below is resolved, and a rename fails HERE rather than
    // quietly passing every assertion in the file.
    // `toContain('export function GlassPanel')` would have been happy
    // with `GlassPanelRenamed` — a fence that a rename walks straight
    // through. The open-paren pins the name exactly.
    expect(file(GlassHeader)).toContain('export function GlassChip({');
    expect(file(GlassHeader)).toContain('export function GlassIslandHeader({');
    expect(file(GlassHeader)).toContain('export function GlassPanel({');
    expect(file(GlassHeader)).toContain('export function StoryBackChip({');
    expect(file(GlassHeader)).toContain('export function useIslandInset(');
    expect(file(Theme)).toContain('export const Glass');
    expect(files.length).toBeGreaterThan(40);
  });
});

describe('there is ONE glass implementation', () => {
  test('only glass-header.tsx touches the native module', () => {
    // Go's ChromeSurface was a third, older copy — real glass with no
    // colorScheme over a live map, falling back to an OPAQUE
    // theme.background slab, the exact material rejected in ded231b.
    // Nothing stopped it existing except nobody looking.
    const importers = files
      .filter((candidate) => /from 'expo-glass-effect'/.test(candidate.text))
      .map((candidate) => candidate.path);
    expect(importers).toEqual([GlassHeader]);
  });

  test('no surface hand-rolls a chip', () => {
    // The read tick did, for three months, which is why it was the one
    // chip in the app that never got real glass on iOS 26. A raw pill
    // radius is the signature: everything round-ended takes the token,
    // so a bare 999 means somebody drew a chip by hand.
    const offenders = files
      .filter((candidate) => /borderRadius:\s*999/.test(candidate.text))
      .map((candidate) => candidate.path);
    expect(offenders).toEqual([]);
  });

  test('there is ONE back chip, and it lives in the glass module', () => {
    // Two screens rendered their own circle-with-a-chevron, both
    // claiming this testID, with the 40pt press box copied into a third
    // file — so a fix to one left the others behind.
    const owners = files
      .filter((candidate) => candidate.text.includes(`testID="story-back"`))
      .map((candidate) => candidate.path)
      .sort();
    // The gazetteer's island row docks the same control INTO the
    // island, which is the one sanctioned second site; nothing else.
    expect(owners).toEqual(['components/area-gazetteer.tsx', GlassHeader]);
  });

  test('the 40pt press box is not copied anywhere', () => {
    const offenders = files
      .filter((candidate) => candidate.path !== GlassHeader)
      .filter((candidate) => /width:\s*40,\s*\n\s*height:\s*40,/.test(candidate.text))
      .map((candidate) => candidate.path);
    expect(offenders).toEqual([]);
  });
});

describe('the glass materials are SANCTIONED MATERIAL, and live in one place', () => {
  // theme.ts's Glass group is registered as sanctioned material with
  // its reason written above it: these are translucent materials and
  // photo scrims, which cannot be Colors entries — a material has to be
  // specified as one, and the photo scrim deliberately ignores the
  // theme. This is that registration, enforced.
  test('the reason is written down, not just asserted', () => {
    expect(file(Theme)).toContain('SANCTIONED MATERIAL');
  });

  test('no chrome grey is spelled anywhere but theme.ts', () => {
    // Three surfaces carried three base greys and three alpha pairs.
    // The alphas were reasoned; the greys were three because three
    // people wrote them.
    const greys = /rgba\(\s*(?:20,\s*20,\s*24|22,\s*22,\s*26|30,\s*30,\s*34|245,\s*245,\s*247)/;
    const offenders = files
      .filter((candidate) => candidate.path !== Theme)
      .filter((candidate) => greys.test(candidate.text))
      .map((candidate) => candidate.path);
    expect(offenders).toEqual([]);
  });

  test('the retired 22,22,26 tick grey is gone from the codebase entirely', () => {
    const survivors = files.filter((candidate) => candidate.text.includes('22, 22, 26'));
    expect(survivors.map((candidate) => candidate.path)).toEqual([]);
  });
});

describe('every island computes its top padding the same way', () => {
  /** Screens that mount a standing island. */
  const islandScreens = files.filter(
    (candidate) =>
      candidate.path !== GlassHeader && candidate.text.includes('<GlassIslandHeader')
  );

  test('there are some, so this fence is not vacuously true', () => {
    expect(islandScreens.length).toBeGreaterThanOrEqual(3);
  });

  test.each(islandScreens.map((candidate) => candidate.path))(
    '%s takes its inset from useIslandInset, or pads nothing at all',
    (path) => {
      const text = file(path);
      // The gazetteer's island OVERLAYS a full-bleed list and reports
      // no height (`onHeight={noHeight}`) — it pads nothing, so it has
      // no inset to compute. Every other island pads its content.
      const overlays = text.includes('onHeight={noHeight}');
      expect(overlays || text.includes('useIslandInset')).toBe(true);
    }
  );

  test.each(islandScreens.map((candidate) => candidate.path))(
    '%s does not spell the inset out by hand',
    (path) => {
      // The three origins that were: `insets.top + islandHeight +
      // IslandBreath` in Saved, a SafeAreaView supplying the top in
      // Nearby, `topOffset={0}` in the Gazetteer. Change the geometry
      // once and two of the three drift.
      expect(file(path)).not.toMatch(/insets\.top\s*\+\s*island/i);
      expect(file(path)).not.toMatch(/IslandBreath/);
    }
  );

  test('an island is never mounted inside a SafeAreaView', () => {
    // Yoga anchors an absolute child to the BORDER box, so a
    // SafeAreaView parent's padding is invisible to the island and the
    // two origins disagree by exactly the notch.
    for (const candidate of islandScreens) {
      const islandAt = candidate.text.indexOf('<GlassIslandHeader');
      const before = candidate.text.slice(0, islandAt);
      // The nearest enclosing tag before the island must not be an
      // unclosed SafeAreaView
      const opens = (before.match(/<SafeAreaView/g) ?? []).length;
      const closes = (before.match(/<\/SafeAreaView>/g) ?? []).length;
      expect({ file: candidate.path, unclosed: opens - closes }).toEqual({
        file: candidate.path,
        unclosed: 0,
      });
    }
  });
});

describe('the named geometry stays named', () => {
  test('the island corner is a token, not a number in a stylesheet', () => {
    expect(file(GlassHeader)).toContain('borderRadius: Radius.island');
    expect(file(GlassHeader)).toContain('borderRadius: Radius.pill');
  });

  test("Go's card and sheet took the names too", () => {
    const go = file('app/history/[pageId]/go.tsx');
    expect(go).toContain('borderRadius: Radius.control');
    expect(go).toContain('borderRadius: Radius.sheet');
  });

  test('chrome shares ONE edge inset', () => {
    // The island's margin and the floating chips' were the same
    // arithmetic spelled out in three files. Chrome that does not share
    // an edge reads as two unrelated objects.
    const chromeFiles = [
      'components/area-gazetteer.tsx',
      'app/history/[pageId]/index.tsx',
      GlassHeader,
    ];
    for (const path of chromeFiles) {
      expect({ path, uses: file(path).includes('ChromeEdgeInset') }).toEqual({
        path,
        uses: true,
      });
    }
    // …and the raw arithmetic is gone from every one of them
    expect(file(GlassHeader)).not.toContain('paddingHorizontal: Spacing.three - 4');
    expect(file('components/area-gazetteer.tsx')).not.toContain('left: Spacing.three - 4');
  });
});
