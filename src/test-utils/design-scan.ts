/**
 * The shared instrument for the design fences.
 *
 * DESIGN.md is a rulebook that, until now, was enforced only by reading
 * it — and the August 2026 review found the same shape over and over: a
 * rule written down, obeyed by hand, quietly broken (#299). These
 * helpers let a jest test read the source the way the reviewer did, but
 * on every push. `src/__tests__/app-config-test.ts` is the precedent:
 * the fence lives in the suite, because the suite is what CI runs.
 *
 * Everything here parses the real AST rather than grepping. Grep cannot
 * tell `#6A4BDB` in a StyleSheet from `#240` in a comment, and half the
 * repo's prose cites issue numbers.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';

/** Repo root, from `src/test-utils/`. */
export const RepoRoot = join(__dirname, '..', '..');

/** The two trees DESIGN.md governs: what the user sees. */
export const UiDirs = ['src/components', 'src/app'] as const;

export type SourceFile = {
  /** Repo-relative, POSIX — the form that goes in a failure message. */
  path: string;
  code: string;
  ast: t.File;
};

const listFiles = (dir: string, out: string[]): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      listFiles(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
};

/**
 * Every `.tsx` under the given repo-relative directories, parsed.
 *
 * `.tsx` only, deliberately: the palette, the type ramp and the control
 * names are rules about rendered UI. `src/app/api/*+api.ts` are server
 * routes and answer in JSON.
 */
export function uiSources(dirs: readonly string[] = UiDirs): SourceFile[] {
  const files: string[] = [];
  for (const dir of dirs) listFiles(join(RepoRoot, dir), files);
  return files.sort().map((full) => {
    const code = readFileSync(full, 'utf8');
    return {
      path: relative(RepoRoot, full).split('\\').join('/'),
      code,
      ast: parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
        // Comments are what carry the "why" at a site; the fences read
        // them to check a sanctioned exception explains itself.
        attachComment: true,
      }),
    };
  });
}

/** Parse one repo-relative file. */
export function uiSource(path: string): SourceFile {
  const code = readFileSync(join(RepoRoot, path), 'utf8');
  return {
    path,
    code,
    ast: parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'], attachComment: true }),
  };
}

/** `file.tsx:123` — half of what a failure message owes the reader. */
export const at = (file: SourceFile, node: t.Node): string =>
  `${file.path}:${node.loc?.start.line ?? 0}`;

export const walk = (file: SourceFile, visitors: Parameters<typeof traverse>[1]): void => {
  traverse(file.ast, visitors);
};

/** `<Pressable>` → `Pressable`, `<Animated.View>` → `Animated.View`. */
export function elementName(node: t.JSXElement): string {
  const name = node.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const object = name.object;
    return `${t.isJSXIdentifier(object) ? object.name : '?'}.${name.property.name}`;
  }
  return '?';
}

/** A named attribute on a JSX element, or undefined. */
export function attribute(node: t.JSXElement, name: string): t.JSXAttribute | undefined {
  return node.openingElement.attributes.find(
    (attr): attr is t.JSXAttribute => t.isJSXAttribute(attr) && attr.name.name === name
  );
}

/** The static string an attribute carries, if it is static at all. */
export function staticString(attr: t.JSXAttribute | undefined): string | null {
  if (!attr) return null;
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (t.isJSXExpressionContainer(attr.value)) {
    const expression = attr.value.expression;
    if (t.isStringLiteral(expression)) return expression.value;
    if (t.isTemplateLiteral(expression)) return expression.quasis.map((q) => q.value.raw).join('*');
  }
  return null;
}

/**
 * The file's `StyleSheet.create({...})` entries, by key.
 *
 * One per file is the house pattern (`const styles = StyleSheet.create`
 * at the foot), so a flat map is enough to resolve `styles.goText`.
 */
export function styleSheet(file: SourceFile): Map<string, t.ObjectExpression> {
  const sheet = new Map<string, t.ObjectExpression>();
  traverse(file.ast, {
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
        if (!t.isObjectProperty(property)) continue;
        const key = t.isIdentifier(property.key)
          ? property.key.name
          : t.isStringLiteral(property.key)
            ? property.key.value
            : null;
        if (key && t.isObjectExpression(property.value)) sheet.set(key, property.value);
      }
    },
  });
  return sheet;
}

/** The value of one property of a style object, if present. */
export function styleProperty(style: t.ObjectExpression, name: string): t.Node | null {
  for (const property of style.properties) {
    if (!t.isObjectProperty(property)) continue;
    if (t.isIdentifier(property.key, { name })) return property.value;
  }
  return null;
}
