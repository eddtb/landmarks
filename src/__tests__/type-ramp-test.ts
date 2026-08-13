/**
 * One voice, one ramp.
 *
 * DESIGN.md: "every size in the app has a tier and a reason; an inline
 * fontSize in a component is drift", and "Unused styles get deleted from
 * ThemedText, not abandoned — dead tokens are how drift starts."
 *
 * Both halves were enforced by reading, and the reading went stale: the
 * doc said "two sanctioned inline sizes" while the code had three, one
 * of which (`pointer-dial.tsx`'s 32) carried a comment at its site
 * explaining itself to nobody who was checking (#299, item 7).
 *
 * So the fence counts them. A fourth fails. A ramp tier nothing renders
 * fails. A sanctioned size that stops explaining itself fails.
 */
import { SanctionedFontSizes } from '@/test-utils/design-allowlist';
import { at, attribute, elementName, uiSource, uiSources, walk } from '@/test-utils/design-scan';
import * as t from '@babel/types';

const ThemedTextFile = 'src/components/themed-text.tsx';

type SizeFinding = { file: string; value: number; where: string; excused: boolean };

/**
 * A sanctioned size has to point back at the rule it is excepting itself
 * from — so the comment above it must say "ramp". One comment may cover
 * two adjacent entries (the dial's 32 and 10 share theirs), hence the
 * twelve-line reach rather than a strictly-attached leading comment.
 */
const ExcuseReach = 12;

const findInlineFontSizes = (): SizeFinding[] => {
  const found: SizeFinding[] = [];
  for (const file of uiSources()) {
    if (file.path === ThemedTextFile) continue; // the ramp itself
    const excuses = (file.ast.comments ?? []).filter((comment) => /\bramp\b/i.test(comment.value));
    walk(file, {
      ObjectProperty(path) {
        if (!t.isIdentifier(path.node.key, { name: 'fontSize' })) return;
        const value = t.isNumericLiteral(path.node.value) ? path.node.value.value : NaN;
        const line = path.node.loc?.start.line ?? 0;
        found.push({
          file: file.path,
          value,
          where: at(file, path.node),
          excused: excuses.some((comment) => {
            const end = comment.loc?.end.line ?? 0;
            return end < line && line - end <= ExcuseReach;
          }),
        });
      },
    });
  }
  return found;
};

describe('the type ramp is the only ramp', () => {
  const findings = findInlineFontSizes();

  test('the scan is actually reading the tree', () => {
    expect(uiSources().length).toBeGreaterThan(25);
    expect(findings.length).toBeGreaterThanOrEqual(SanctionedFontSizes.length);
  });

  test('no inline fontSize outside the three sanctioned sites', () => {
    const rogue = findings.filter(
      (finding) =>
        !SanctionedFontSizes.some(
          (entry) => entry.file === finding.file && entry.value === finding.value
        )
    );

    expect(
      rogue.map(
        (finding) =>
          `${finding.where}  fontSize: ${finding.value}\n` +
          `    RULE: DESIGN.md — every size has a tier. Three inline sizes are sanctioned in the\n` +
          `          whole app (the search field's 15, the dial's 32 and 10); this is a fourth.\n` +
          `    FIX:  use a ThemedText tier — display 34 · largeTitle 28 · title 21 · pullQuote 18 ·\n` +
          `          lede 17.5 · headline 16 · default 16 · small 14 · smallBold 14 · linkPrimary 14 ·\n` +
          `          eyebrow 11 · caption 11 · captionBold 11.\n` +
          `          If the element genuinely cannot take a tier (a TextInput, a fixed geometry),\n` +
          `          comment the reason AT the site and add it to SanctionedFontSizes in\n` +
          `          src/test-utils/design-allowlist.ts.`
      )
    ).toEqual([]);
  });

  test('each sanctioned size still explains itself at its site', () => {
    // The comment is the whole difference between an exception and a
    // mistake; a size that loses its reason is a size nobody can defend.
    const silent = findings.filter((finding) => !finding.excused);
    expect(
      silent.map(
        (finding) =>
          `${finding.where}  fontSize: ${finding.value} is sanctioned but no longer says why.\n` +
          `    RULE: an inline size must name the ramp it is stepping outside of, at its site.\n` +
          `    FIX:  restore a comment within ${ExcuseReach} lines above that explains why this\n` +
          `          text cannot take a ThemedText tier — or move it onto one.`
      )
    ).toEqual([]);
  });

  test('every sanctioned size is still there', () => {
    const orphans = SanctionedFontSizes.filter(
      (entry) => !findings.some((f) => f.file === entry.file && f.value === entry.value)
    );
    expect(
      orphans.map(
        (entry) =>
          `${entry.file} fontSize: ${entry.value} is sanctioned but gone.\n` +
          `    FIX: delete the entry from SanctionedFontSizes in src/test-utils/design-allowlist.ts.`
      )
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------
// Dead tokens are how drift starts
// ---------------------------------------------------------------------

/** The `type` union in ThemedTextProps. */
const rampTiers = (): string[] => {
  const file = uiSource(ThemedTextFile);
  const tiers: string[] = [];
  walk(file, {
    TSPropertySignature(path) {
      if (!t.isIdentifier(path.node.key, { name: 'type' })) return;
      const annotation = path.node.typeAnnotation?.typeAnnotation;
      if (!t.isTSUnionType(annotation)) return;
      for (const member of annotation.types) {
        if (t.isTSLiteralType(member) && t.isStringLiteral(member.literal)) {
          tiers.push(member.literal.value);
        }
      }
    },
  });
  return tiers;
};

/** The keys of ThemedText's own StyleSheet. */
const rampStyles = (): string[] => {
  const file = uiSource(ThemedTextFile);
  const keys: string[] = [];
  walk(file, {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        !t.isMemberExpression(callee) ||
        !t.isIdentifier(callee.object, { name: 'StyleSheet' }) ||
        !t.isIdentifier(callee.property, { name: 'create' })
      ) {
        return;
      }
      const [arg] = path.node.arguments;
      if (!t.isObjectExpression(arg)) return;
      for (const property of arg.properties) {
        if (t.isObjectProperty(property) && t.isIdentifier(property.key)) {
          keys.push(property.key.name);
        }
      }
    },
  });
  return keys;
};

/** Every tier any screen actually asks for, `type="x"` or `type={cond ? 'x' : 'y'}`. */
const tiersInUse = (): Set<string> => {
  const used = new Set<string>();
  for (const file of uiSources()) {
    if (file.path === ThemedTextFile) continue;
    walk(file, {
      JSXElement(path) {
        if (elementName(path.node) !== 'ThemedText') return;
        const attr = attribute(path.node, 'type');
        if (!attr) {
          used.add('default'); // the implicit tier
          return;
        }
        if (t.isStringLiteral(attr.value)) {
          used.add(attr.value.value);
          return;
        }
        if (t.isJSXExpressionContainer(attr.value)) {
          // `type={index === 0 ? 'lede' : 'default'}` — both count.
          path.get('openingElement').traverse({
            StringLiteral(literal) {
              used.add(literal.node.value);
            },
          });
        }
      },
    });
  }
  return used;
};

describe('no dead tokens in the ramp', () => {
  const tiers = rampTiers();
  const styles = rampStyles();

  test('every tier in the union has a style, and every style has a tier', () => {
    expect(tiers.length).toBeGreaterThan(5);
    expect([...styles].sort()).toEqual([...tiers].sort());
  });

  test('every tier is rendered somewhere', () => {
    const used = tiersInUse();
    const dead = tiers.filter((tier) => !used.has(tier));

    expect(
      dead.map(
        (tier) =>
          `ThemedText type "${tier}" is defined in ${ThemedTextFile} and rendered nowhere.\n` +
          `    RULE: DESIGN.md — "Unused styles get deleted from ThemedText, not abandoned —\n` +
          `          dead tokens are how drift starts."\n` +
          `    FIX:  delete the tier from the ThemedTextProps union AND from the StyleSheet.\n` +
          `          If it is about to be used, use it in the same PR.`
      )
    ).toEqual([]);
  });
});
