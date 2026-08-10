/**
 * The design system's ledger of exceptions.
 *
 * DESIGN.md says "Six colours. Nothing else is allowed in." and names
 * exactly three inline font sizes. Both rules have real exceptions, and
 * an exception nobody wrote down is indistinguishable from a mistake —
 * which is how #299's audit found a `#31406B` navy sitting quietly
 * beside four sanctioned whites.
 *
 * So: two lists, and the difference between them is the whole point.
 *
 * `Sanctioned*` — approved, with the reason at the entry. The fences
 * pass these.
 *
 * `Quarantined*` — known violations that this branch may not fix,
 * because four agents are live in `src/components/`. They are asserted
 * EXACTLY: a new violation fails because it isn't listed, and a FIXED
 * violation fails too, because the entry outlived the bug. The list can
 * only shrink, and it has to shrink deliberately. Nothing here is
 * forgiven — it is scheduled.
 */

/** A colour literal a component is allowed to spell out, and why. */
export type SanctionedColour = {
  /** Repo-relative path. */
  file: string;
  /** The literal exactly as written. */
  value: string;
  reason: string;
};

/**
 * The three shapes that earn a literal:
 *
 * 1. **White on a photo scrim.** Over imagery there is no light mode
 *    and no dark mode — there is a photograph, and ink that has to
 *    survive it. `theme.text` would invert to black over a night sky.
 * 2. **Material.** Glass and scrims are translucency recipes, not
 *    palette entries: a token cannot express "20,20,24 at 65%".
 * 3. **A deliberate single look.** A surface that commits to one
 *    appearance in both schemes (the black image viewer, the brand
 *    gate) and says so at the site.
 */
export const SanctionedColours: readonly SanctionedColour[] = [
  // ---- 1. White on a photo scrim -------------------------------------
  {
    file: 'src/components/area-gazetteer.tsx',
    value: '#FFFFFF',
    reason:
      'Hero title, dim subtitle, photo credit and the glass chip glyph all sit on the shaded hero photograph. White holds over any sky; theme.text would go black in light mode.',
  },
  {
    file: 'src/components/area-gazetteer.tsx',
    value: 'rgba(0,0,0,0.35)',
    reason: 'The hero shade itself — the scrim that makes the white legible.',
  },
  {
    file: 'src/components/history-card.tsx',
    value: '#FFFFFF',
    reason: 'The read tick rides on the card photo, inside its own dark scrim (633e4a6).',
  },
  {
    file: 'src/app/history/[pageId]/index.tsx',
    value: '#FFFFFF',
    reason:
      'The floating back chevron and the ⋯ tint are the photo-chip pair: glass pinned dark over the hero, so the glyph is white in both schemes.',
  },
  // ---- 2. Material ---------------------------------------------------
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(20, 20, 24, 0.65)',
    reason:
      'Real glass ADAPTS to its backdrop and went light under white glyphs over a bright sky. The tint inks the material itself.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(20, 20, 24, 0.75)',
    reason:
      'The no-glass fallback chip: 0.75, not the tick’s 0.55, because a 40pt chip must hold a lone glyph against a bright sky.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(255, 255, 255, 0.30)',
    reason: 'The fallback chip’s own hairline edge — glass draws its own, a scrim cannot.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(30, 30, 34, 0.86)',
    reason:
      'The island fallback, dark scheme. The island sits over TEXT, not imagery, so unlike the chips it keeps scheme translucency.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(245, 245, 247, 0.88)',
    reason: 'The island fallback, light scheme.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(255, 255, 255, 0.12)',
    reason: 'The island fallback’s hairline, dark scheme.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: 'rgba(23, 24, 26, 0.10)',
    reason: 'The island fallback’s hairline, light scheme.',
  },
  {
    file: 'src/components/glass-header.tsx',
    value: '#000',
    reason: 'shadowColor — a shadow is a light source, not a palette entry.',
  },
  {
    file: 'src/components/history-card.tsx',
    value: 'rgba(22, 22, 26, 0.55)',
    reason: 'The read tick’s translucent ink: 55% over a photo reads frosted without expo-blur.',
  },
  {
    file: 'src/components/history-card.tsx',
    value: 'rgba(255, 255, 255, 0.25)',
    reason: 'The read tick’s hairline.',
  },
  // ---- 3. A deliberate single look ------------------------------------
  {
    file: 'src/components/image-viewer.tsx',
    value: '#000000',
    reason:
      'The image viewer is deliberately single-look black in both schemes — a photograph is shown against black or it is shown wrong.',
  },
  {
    file: 'src/components/image-viewer.tsx',
    value: '#FFFFFF',
    reason: 'The viewer’s credit and Close label, on that fixed black.',
  },
  {
    file: 'src/components/image-viewer.tsx',
    value: 'rgba(255,255,255,0.15)',
    reason: 'The Close chip on the fixed black — a lift, not a colour.',
  },
  {
    file: 'src/components/one-door.tsx',
    value: '#FFFFFF',
    reason:
      'The gate wears BrandPurple (the LIGHT accent) full-bleed in both schemes, precisely because white on the dark accent fails contrast. White on BrandPurple is 5.77:1 — see palette-test.',
  },
  {
    file: 'src/components/one-door.tsx',
    value: 'rgba(255, 255, 255, 0.85)',
    reason: 'The gate brandmark, one step back from the title on the same fixed ground.',
  },
  {
    file: 'src/components/one-door.tsx',
    value: 'rgba(255, 255, 255, 0.82)',
    reason: 'The gate body copy on the same fixed ground.',
  },
  {
    file: 'src/components/one-door.tsx',
    value: 'rgba(255, 255, 255, 0.9)',
    reason: 'The gate’s Not now, quieter than the warm CTA beside it.',
  },
];

/** A colour literal that should not exist, with the fix and its issue. */
export type QuarantinedColour = SanctionedColour & { issue: string; fix: string };

/**
 * Genuine violations this branch is not allowed to touch — every one
 * lives in `src/components/`, where other agents are working. Each says
 * what to write instead. Delete the entry in the same commit as the fix.
 */
export const QuarantinedColours: readonly QuarantinedColour[] = [
  {
    file: 'src/components/area-gazetteer.tsx',
    value: '#31406B',
    issue: '#299 (item 8)',
    fix: 'theme.backgroundElement',
    reason:
      'A navy behind the hero with no comment and no palette provenance — the one genuinely rogue literal the audit found.',
  },
  {
    file: 'src/components/animated-icon.tsx',
    value: '#8B6FF0',
    issue: '#299 (item 9)',
    fix: 'delete AnimatedIcon — main already did, in #234',
    reason:
      'Expo-template residue: the gradient of a component imported nowhere, rendering expo-logo.png.',
  },
  {
    file: 'src/components/animated-icon.tsx',
    value: '#5A3BC9',
    issue: '#299 (item 9)',
    fix: 'delete AnimatedIcon — main already did, in #234',
    reason: 'The other half of the dead gradient.',
  },
  {
    file: 'src/components/animated-icon.tsx',
    value: '#6A4BDB',
    issue: '#299 (item 10)',
    fix: 'BrandPurple from @/constants/theme',
    reason:
      'The splash overlay’s ground IS the accent, spelled out. Right colour, wrong spelling: change the accent token and the splash silently keeps the old violet. (The value must also stay equal to app.json’s splash backgroundColor — palette-test asserts that too.)',
  },
];

/** An inline `fontSize` outside ThemedText's ramp, and why it earns one. */
export type SanctionedFontSize = { file: string; value: number; reason: string };

/**
 * DESIGN.md: "an inline fontSize in a component is drift". These three
 * are the whole sanctioned set, and each is commented at its site — the
 * type-ramp fence checks the comment as well as the number.
 */
export const SanctionedFontSizes: readonly SanctionedFontSize[] = [
  {
    file: 'src/components/place-search.tsx',
    value: 15,
    reason:
      'The area search TextInput (extracted from section-screen in #307, comment and all). A TextInput is not a ThemedText and cannot take a ramp tier; 15 sits between `small` and `default` for a comfortable field.',
  },
  {
    file: 'src/components/pointer-dial.tsx',
    value: 32,
    reason:
      'The dial’s big number, sized by the fixed ring geometry rather than by the ramp — bespoke by geometry, capped like all chrome.',
  },
  {
    file: 'src/components/pointer-dial.tsx',
    value: 10,
    reason: 'The dial’s compact cardinal, the other half of the same geometry.',
  },
];

/**
 * Tappables whose accessible name still carries a glyph.
 *
 * DESIGN.md: signals are words, never glyphs (#186). A control glyph is
 * allowed to be DRAWN — the back chevron and the ⋯ both are — but it
 * must not be what VoiceOver reads out, which is what an
 * `accessibilityLabel` fixes. These four have no label, so the glyph is
 * the name: "Read the story, Newington Butts, single right-pointing
 * angle quotation mark".
 */
export const QuarantinedControlNames: readonly {
  file: string;
  name: string;
  glyph: string;
  fix: string;
}[] = [
  {
    file: 'src/components/quiz-run.tsx',
    name: 'Read the story — {title} ›',
    glyph: '›',
    fix: 'drop the › (the label is already a full sentence) or give the Pressable accessibilityLabel="Read the story"',
  },
  {
    file: 'src/components/quiz-run.tsx',
    name: "{result.right ? 'Right' : 'Missed'} {result.label} Story ›",
    glyph: '›',
    fix: 'accessibilityLabel="Read the story" on the result row’s Pressable',
  },
  {
    file: 'src/components/quiz-direction.tsx',
    name: 'Read {question.title} ›',
    glyph: '›',
    fix: 'drop the › or give the Pressable accessibilityLabel="Read this story"',
  },
];

/**
 * Components the React Compiler currently refuses, with the compiler's
 * own reason. Every one is in `src/components/` and off-limits here.
 *
 * A bail is silent: no warning, no lint failure, no build failure — the
 * component simply renders unmemoized forever while the file beside it
 * looks identical. That is why this list exists at all.
 */
export const QuarantinedCompilerBails: readonly {
  file: string;
  component: string;
  category: string;
  fix: string;
}[] = [
  {
    file: 'src/components/area-gazetteer.tsx',
    component: 'AreaGazetteer',
    category: 'Todo',
    fix: 'the conditional inside the try/catch must leave the component — extract a module-level async helper that returns a verdict. Hoisting it out of the try does not help.',
  },
  {
    file: 'src/components/image-viewer.tsx',
    component: 'ImageViewer',
    category: 'Immutability',
    fix: 'dragY is mutated after being used as an effect dependency — move the mutation before the useEffect, or hold it in a ref the effect does not depend on.',
  },
  {
    file: 'src/components/quiz-run.tsx',
    component: 'Results',
    category: 'Suppression',
    fix: 'remove the `eslint-disable-next-line react-hooks/exhaustive-deps` and satisfy the dependency array; one disable de-optimises the whole component.',
  },
  {
    file: 'src/components/quiz-screen.tsx',
    component: 'QuizBody',
    category: 'Suppression',
    fix: 'remove the `eslint-disable-next-line react-hooks/exhaustive-deps` and satisfy the dependency array.',
  },
];
