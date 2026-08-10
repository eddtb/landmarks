/**
 * "Six colours. Nothing else is allowed in." — DESIGN.md
 *
 * Enforced by reading, until the August 2026 audit read it properly and
 * found a `#31406B` navy behind the History hero with no comment and no
 * provenance, a dead Expo-template gradient, and white on an accent that
 * fails contrast in dark mode at 2.79:1 (#297, #299).
 *
 * Three fences here:
 *
 *   1. no colour literal in `src/components` or `src/app` that isn't in
 *      the allowlist WITH a reason (src/test-utils/design-allowlist.ts);
 *   2. no white text on an accent surface — on the accent, text takes
 *      `theme.background`, and the arithmetic is asserted, not asserted-
 *      by-assertion;
 *   3. the colours that ship in the BINARY (app.json's splash and
 *      adaptive icon) are palette colours, because nothing else in the
 *      suite ever looks at them.
 */
import { Colors } from '@/constants/theme';
import {
  QuarantinedColours,
  SanctionedColours,
  type SanctionedColour,
} from '@/test-utils/design-allowlist';
import { at, styleProperty, styleSheet, uiSources, walk } from '@/test-utils/design-scan';
import * as t from '@babel/types';

import appJson from '../../app.json';

const Hex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ColourFunction = /\b(?:rgba?|hsla?)\s*\(/;
const HexInText = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/;

/**
 * Deliberately short. The job is catching `color: 'white'`, not linting
 * English — so a named colour only counts as one when it is the value of
 * something colour-shaped (see `namesAColour`).
 */
const NamedColours = new Set([
  'white',
  'black',
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'purple',
  'violet',
  'grey',
  'gray',
  'silver',
  'navy',
  'teal',
  'lime',
  'aqua',
  'cyan',
  'magenta',
  'fuchsia',
  'maroon',
  'olive',
  'pink',
  'brown',
  'gold',
  'indigo',
  'crimson',
  'turquoise',
  'lavender',
]);

/**
 * `transparent` is not in the palette and never will be: it is the
 * absence of a colour, and RN has no token for absence.
 */
const NotAColour = new Set(['transparent', 'none']);

const colourish = /colou?r|tint|background|shadow|border|fill|stroke/i;

const namesAColour = (path: { parent: t.Node }): boolean => {
  const parent = path.parent;
  if (t.isObjectProperty(parent) && t.isIdentifier(parent.key)) {
    return colourish.test(parent.key.name);
  }
  if (t.isJSXAttribute(parent) && t.isJSXIdentifier(parent.name)) {
    return colourish.test(parent.name.name);
  }
  return false;
};

type Finding = { file: string; value: string; where: string };

const findColourLiterals = (): Finding[] => {
  const found: Finding[] = [];
  for (const file of uiSources()) {
    walk(file, {
      StringLiteral(path) {
        const value = path.node.value;
        if (NotAColour.has(value)) return;
        const isColour =
          Hex.test(value) ||
          ColourFunction.test(value) ||
          (NamedColours.has(value.toLowerCase()) && namesAColour(path));
        if (isColour) found.push({ file: file.path, value, where: at(file, path.node) });
      },
      TemplateElement(path) {
        const raw = path.node.value.raw;
        for (const match of raw.match(new RegExp(HexInText, 'g')) ?? []) {
          found.push({ file: file.path, value: match, where: at(file, path.node) });
        }
        if (ColourFunction.test(raw)) {
          found.push({ file: file.path, value: raw.trim(), where: at(file, path.node) });
        }
      },
    });
  }
  return found;
};

const listed = (list: readonly SanctionedColour[], finding: Finding): boolean =>
  list.some((entry) => entry.file === finding.file && entry.value === finding.value);

describe('the palette is six colours', () => {
  const findings = findColourLiterals();

  test('the scan is actually reading the tree', () => {
    // A fence that quietly scans nothing passes every other test here.
    expect(uiSources().length).toBeGreaterThan(25);
    expect(findings.length).toBeGreaterThan(15);
  });

  test('no colour literal outside the allowlist', () => {
    const rogue = findings.filter(
      (finding) => !listed(SanctionedColours, finding) && !listed(QuarantinedColours, finding)
    );

    expect(
      rogue.map(
        (finding) =>
          `${finding.where}  ${finding.value}\n` +
          `    RULE: DESIGN.md — "Six colours. Nothing else is allowed in."\n` +
          `    FIX:  use a theme token (theme.text · theme.textSecondary · theme.background ·\n` +
          `          theme.backgroundElement · theme.accent · theme.accentSoft · theme.accentWarm).\n` +
          `          If this literal is genuinely material — white on a photo scrim, a glass\n` +
          `          recipe, a deliberate single look — add it to SanctionedColours in\n` +
          `          src/test-utils/design-allowlist.ts WITH the reason, and exempt the file in\n` +
          `          eslint.config.js. A literal with no reason beside it is the bug this fence exists for.`
      )
    ).toEqual([]);
  });

  test('every sanctioned literal is still there — a stale reason is worse than none', () => {
    // An allowlist that outlives its entries stops being a list of
    // exceptions and becomes a list of permissions.
    const orphans = SanctionedColours.filter(
      (entry) => !findings.some((f) => f.file === entry.file && f.value === entry.value)
    );
    expect(
      orphans.map(
        (entry) =>
          `${entry.file}  ${entry.value} is allowlisted but no longer appears.\n` +
          `    FIX: delete the entry from SanctionedColours in src/test-utils/design-allowlist.ts.`
      )
    ).toEqual([]);
  });

  test('a fixed violation leaves the quarantine list', () => {
    // The other direction of the ratchet, and the reason the list can
    // only ever shrink: a quarantined violation that no longer exists is
    // an entry granting permission to reintroduce it.
    const fixed = QuarantinedColours.filter(
      (entry) => !findings.some((f) => f.file === entry.file && f.value === entry.value)
    );

    expect(
      fixed.map(
        (entry) =>
          `${entry.file}  ${entry.value} is fixed — well done.\n` +
          `    FIX: delete its entry from QuarantinedColours in\n` +
          `         src/test-utils/design-allowlist.ts, in the same commit as the repair.`
      )
    ).toEqual([]);
  });

  test('the lint exemptions and the allowlist name the same files', () => {
    // eslint.config.js catches a hex the moment it is typed, but its
    // granularity is the FILE. This test's granularity is the VALUE.
    // They have to agree about which files speak in materials, or one of
    // them is quietly forgiving something the other refuses.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const eslintConfig = require('../../eslint.config.js') as {
      files?: string[];
      rules?: Record<string, unknown>;
    }[];
    const exempted = new Set(
      eslintConfig
        .filter((block) => block.rules && block.rules['no-restricted-syntax'] === 'off')
        // Unescaped: the config escapes `[pageId]` so minimatch reads it
        // as a directory name rather than a character class.
        .flatMap((block) => (block.files ?? []).map((glob) => glob.replace(/\\/g, '')))
    );
    const allowlisted = new Set(
      [...SanctionedColours, ...QuarantinedColours].map((entry) => entry.file)
    );

    expect([...exempted].sort()).toEqual([...allowlisted].sort());
  });
});

// ---------------------------------------------------------------------
// White on the accent — issue #297
// ---------------------------------------------------------------------

/** WCAG 2.1 relative luminance. */
const luminance = (hex: string): number => {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

const round = (n: number) => Math.round(n * 100) / 100;

const White = new Set(['#FFFFFF', '#ffffff', '#FFF', '#fff', 'white']);
const isWhiteLiteral = (node: t.Node | null): boolean =>
  (t.isStringLiteral(node) && (White.has(node.value) || /rgba?\(\s*255\s*,/.test(node.value))) ||
  false;

describe('text on the accent takes theme.background, not white', () => {
  test('the arithmetic: white fails on the dark accent, background passes on both', () => {
    // This is the whole reason for the rule, and it was written down
    // WRONG until #297: "White on the accent … holds in both modes".
    expect(round(contrast('#FFFFFF', Colors.dark.accent))).toBeLessThan(3);
    expect(round(contrast('#FFFFFF', Colors.dark.accent))).toBe(2.79);

    // theme.background against theme.accent, in each scheme, clears AA.
    expect(contrast(Colors.light.background, Colors.light.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(Colors.dark.background, Colors.dark.accent)).toBeGreaterThanOrEqual(4.5);

    // The one-door gate is the exception that proves it: it wears the
    // LIGHT accent in both schemes precisely so its white copy holds.
    expect(contrast('#FFFFFF', Colors.light.accent)).toBeGreaterThanOrEqual(4.5);
  });

  test('no component paints white text on a theme.accent surface', () => {
    const violations: string[] = [];

    for (const file of uiSources()) {
      const sheet = styleSheet(file);

      walk(file, {
        ObjectProperty(path) {
          // Find `backgroundColor: theme.accent` wherever it is written —
          // inline, in a style array, inside a pressed-state callback.
          if (!t.isIdentifier(path.node.key, { name: 'backgroundColor' })) return;
          const value = path.node.value;
          if (
            !t.isMemberExpression(value) ||
            !t.isIdentifier(value.object, { name: 'theme' }) ||
            !t.isIdentifier(value.property, { name: 'accent' })
          ) {
            return;
          }

          const surface = path.findParent((p) => p.isJSXElement());
          if (!surface) return;

          // Everything the surface renders: a `styles.x` reference
          // resolved against the file's sheet, or an inline object.
          surface.traverse({
            MemberExpression(styleRef) {
              if (
                !t.isIdentifier(styleRef.node.object, { name: 'styles' }) ||
                !t.isIdentifier(styleRef.node.property)
              ) {
                return;
              }
              const entry = sheet.get(styleRef.node.property.name);
              if (!entry) return;
              if (isWhiteLiteral(styleProperty(entry, 'color'))) {
                violations.push(
                  `${at(file, styleRef.node)}  styles.${styleRef.node.property.name} paints white text on theme.accent`
                );
              }
            },
            ObjectProperty(inline) {
              if (!t.isIdentifier(inline.node.key, { name: 'color' })) return;
              if (isWhiteLiteral(inline.node.value)) {
                violations.push(`${at(file, inline.node)}  white text on theme.accent`);
              }
            },
          });
        },
      });
    }

    expect(
      violations.map(
        (violation) =>
          `${violation}\n` +
          `    RULE: text on an accent surface takes theme.background (#297).\n` +
          `    WHY:  #FFFFFF on the dark accent (${Colors.dark.accent}) is ${round(
            contrast('#FFFFFF', Colors.dark.accent)
          )}:1 — below the 4.5:1 floor.\n` +
          `          theme.background gives ${round(
            contrast(Colors.light.background, Colors.light.accent)
          )}:1 light and ${round(
            contrast(Colors.dark.background, Colors.dark.accent)
          )}:1 dark.\n` +
          `    FIX:  { color: theme.background } — the pattern quiz-run.tsx already uses.`
      )
    ).toEqual([]);
  });
});

describe('the colours that ship inside the binary', () => {
  // Nothing else in the suite looks at these, and they are the two
  // colours a user sees BEFORE any JS runs.
  const plugins: unknown[] = appJson.expo.plugins;
  const splash = plugins.find(
    (plugin): plugin is [string, { backgroundColor?: string }] =>
      Array.isArray(plugin) && plugin[0] === 'expo-splash-screen'
  );

  test('the splash ground is the accent', () => {
    expect(splash?.[1].backgroundColor).toBe(Colors.light.accent);
  });

  test('the Android adaptive icon ground is the accent', () => {
    expect(appJson.expo.android.adaptiveIcon.backgroundColor).toBe(Colors.light.accent);
  });
});
