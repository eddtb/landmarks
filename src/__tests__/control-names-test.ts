/**
 * Controls are words, not glyphs.
 *
 * DESIGN.md: "Signals are words in the line, never glyphs (the speaker
 * emoji was tried and vetoed, #186)." The rule is about what VoiceOver
 * reads out, which is why it survives a glyph being DRAWN: the back
 * chevron and the ⋯ overflow are both glyphs, and both are fine,
 * because each carries an `accessibilityLabel` and the label is what
 * becomes the accessible name.
 *
 * A tappable with no label takes its name from its text, glyph and all —
 * "Read the story, Newington Butts, single right-pointing angle
 * quotation mark". That is the failure this fence catches, and it is
 * live in two files today.
 */
import { QuarantinedControlNames } from '@/test-utils/design-allowlist';
import { at, attribute, elementName, staticString, uiSources, walk } from '@/test-utils/design-scan';
import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

/**
 * Glyphs that stand IN PLACE OF a word — closes, chevrons, carets,
 * arrows, stars, the hamburger.
 *
 * Deliberately absent:
 *  · and — and / — punctuation inside a phrase ("2 min walk · Wikipedia"),
 *    which a screen reader treats as a pause, not a symbol;
 *  ✓ — the read tick rides WITH its word ("✓ Read"), which is the
 *    approved treatment from three mocked options (633e4a6). It marks a
 *    state beside a word; it does not replace one.
 */
const ControlGlyphs = [
  '✕',
  '✖',
  '✗',
  '×',
  '⨯',
  '◼',
  '◾',
  '▪',
  '■',
  '▶',
  '►',
  '◀',
  '◄',
  '▼',
  '▲',
  '▾',
  '▴',
  '›',
  '‹',
  '»',
  '«',
  '⌄',
  '⌃',
  '⋯',
  '⋮',
  '☰',
  '≡',
  '→',
  '←',
  '↑',
  '↓',
  '⚙',
  '✦',
  '★',
  '☆',
  '♥',
  '♡',
  '⚑',
];

const glyphsIn = (text: string): string[] => ControlGlyphs.filter((glyph) => text.includes(glyph));

/** Anything the user can tap: by component name, by onPress, by role. */
const isTappable = (node: t.JSXElement): boolean => {
  const name = elementName(node);
  if (/^(Pressable|Touchable\w*|Button|Link|ExternalLink)$/.test(name)) return true;
  if (attribute(node, 'onPress')) return true;
  const role = staticString(attribute(node, 'accessibilityRole'));
  return role === 'button' || role === 'link';
};

/** Does this subtree contain JSX of its own? */
const containsJsx = (path: NodePath): boolean => {
  let found = false;
  path.traverse({
    JSXElement() {
      found = true;
    },
  });
  return found;
};

/**
 * The accessible name React Native will compute for a tappable.
 *
 * An `accessibilityLabel` REPLACES what is under it — on the tappable
 * itself, or on any element inside it (which is how `overflow-menu`
 * names its ⋯). Otherwise the name is the text: literal runs kept
 * verbatim, dynamic holes kept as their source so the message reads
 * like the JSX it is complaining about. Nested tappables are their own
 * controls and do not fold into the outer one.
 */
const accessibleName = (file: { code: string }, tappable: NodePath<t.JSXElement>): string => {
  const own = staticString(attribute(tappable.node, 'accessibilityLabel'));
  if (own !== null) return own;
  if (attribute(tappable.node, 'accessibilityLabel')) return '{dynamic label}';

  const parts: string[] = [];
  const source = (node: t.Node) => file.code.slice(node.start ?? 0, node.end ?? 0);

  tappable.traverse({
    JSXElement(path) {
      const label = attribute(path.node, 'accessibilityLabel');
      if (label) {
        parts.push(staticString(label) ?? '{dynamic label}');
        path.skip();
        return;
      }
      if (isTappable(path.node)) path.skip();
    },
    JSXText(path) {
      const text = path.node.value.trim().replace(/\s+/g, ' ');
      if (text) parts.push(text);
    },
    JSXExpressionContainer(path) {
      if (!t.isJSXElement(path.parent) && !t.isJSXFragment(path.parent)) return; // an attribute
      if (containsJsx(path)) return; // keep walking; the text is inside
      parts.push(source(path.node).replace(/\s+/g, ' '));
      path.skip();
    },
  });

  return parts.join(' ');
};

type NameFinding = { file: string; where: string; name: string; glyphs: string[] };

const findGlyphNames = (): NameFinding[] => {
  const found: NameFinding[] = [];

  for (const file of uiSources()) {
    walk(file, {
      JSXElement(path) {
        if (!isTappable(path.node)) return;
        const name = accessibleName(file, path);
        const glyphs = glyphsIn(name);
        if (glyphs.length === 0) return;
        found.push({ file: file.path, where: at(file, path.node), name, glyphs });
      },
    });
  }
  return found;
};

describe('a control says its name in words', () => {
  const findings = findGlyphNames();

  test('the scan is actually reading the tree', () => {
    expect(uiSources().length).toBeGreaterThan(25);
    // The sanctioned glyph controls (back chevron ×3, ⋯ ×3) must be
    // FOUND and then excused by their labels — not missed entirely.
    let drawn = 0;
    for (const file of uiSources()) {
      traverse(file.ast, {
        JSXText(path) {
          if (glyphsIn(path.node.value).length > 0) drawn += 1;
        },
      });
    }
    expect(drawn).toBeGreaterThanOrEqual(6);
  });

  test('no glyph reaches an accessible name', () => {
    const rogue = findings.filter(
      (finding) =>
        !QuarantinedControlNames.some(
          (entry) => entry.file === finding.file && entry.name === finding.name
        )
    );

    expect(
      rogue.map(
        (finding) =>
          `${finding.where}  "${finding.name}"  →  VoiceOver reads ${finding.glyphs.join(' ')}\n` +
          `    RULE: DESIGN.md — signals are words, never glyphs (#186).\n` +
          `    FIX:  drop the glyph from the text, or give the tappable an accessibilityLabel in\n` +
          `          words — the label becomes the accessible name and the glyph stays drawn.\n` +
          `          The back chevron and the ⋯ overflow both do exactly this.`
      )
    ).toEqual([]);
  });

  test('a fixed leak leaves the quarantine list', () => {
    // The other direction of the ratchet: the list may only shrink.
    const fixed = QuarantinedControlNames.filter(
      (entry) => !findings.some((finding) => finding.file === entry.file && finding.name === entry.name)
    );

    expect(
      fixed.map(
        (entry) =>
          `${entry.file}  "${entry.name}" is fixed — well done.\n` +
          `    FIX: delete its entry from QuarantinedControlNames in\n` +
          `         src/test-utils/design-allowlist.ts, in the same commit as the repair.`
      )
    ).toEqual([]);
  });
});
