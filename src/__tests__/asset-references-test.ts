import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every `@/assets/…` a component asks for must exist on disk.
 *
 * Paid for on 2026-08-12. A merge took main's deletion of the orphan
 * splash assets while keeping this branch's `animated-icon.tsx`, which
 * still required one of them. Typecheck passed (tsc never resolves a
 * require() of a PNG), lint passed, and all 1,010 tests passed —
 * because jest's moduleNameMapper hands back a stub for anything under
 * assets/ without looking. The only thing that noticed was Metro,
 * bundling for a real device, which is the last place you want to find
 * out and the one place nothing runs in CI.
 *
 * A missing asset is not a style question, so this does not live with
 * the design fences: it is a build that cannot succeed, wearing a green
 * tick.
 */

const SourceRoot = join(__dirname, '..');
const RepoRoot = join(SourceRoot, '..');
const AssetReference = /@\/assets\/[a-zA-Z0-9/._-]+/g;
// The other spelling Metro resolves and jest stubs identically: a
// relative climb out of src/ into assets/. None exist today; the first
// one somebody writes is under this fence the moment it lands.
const RelativeAssetReference = /(?:\.\.\/)+assets\/[a-zA-Z0-9/._-]+/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function referencesIn(file: string): { reference: string; resolved: string }[] {
  const source = readFileSync(file, 'utf8');
  return [
    ...(source.match(AssetReference) ?? []).map((reference) => ({
      reference,
      resolved: join(RepoRoot, reference.replace('@/', '')),
    })),
    ...(source.match(RelativeAssetReference) ?? []).map((reference) => ({
      reference,
      resolved: join(file, '..', reference),
    })),
  ];
}

const files = sourceFiles(SourceRoot);
const referenced = files.flatMap((file) =>
  referencesIn(file).map(({ reference, resolved }) => ({
    file: file.slice(RepoRoot.length + 1),
    reference,
    resolved,
  }))
);

/** Every "./assets/…" and "./plugins/…" string anywhere in app.json —
 * icon, splash, adaptive-icon, favicon, and whatever a plugin block
 * names. A deleted splash image bundle-fails exactly like a deleted
 * component asset, and the config plugins are require()d by prebuild. */
function appJsonReferences(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    if (node.startsWith('./assets/') || node.startsWith('./plugins/')) {
      found.push(node);
    }
  } else if (Array.isArray(node)) {
    node.forEach((child) => appJsonReferences(child, found));
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((child) => appJsonReferences(child, found));
  }
  return found;
}

const appJson = JSON.parse(readFileSync(join(RepoRoot, 'app.json'), 'utf8')) as unknown;
const appJsonReferenced = appJsonReferences(appJson);

describe('asset references', () => {
  // Without this, deleting every asset in the app would leave the suite
  // below green and silent — the failure mode this file exists to end.
  test('the scan is actually reading the tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(referenced.length).toBeGreaterThan(0);
    // app.json names at least the icon, the splash and the favicon;
    // an empty walk here would mean the walker broke, not the config
    expect(appJsonReferenced.length).toBeGreaterThanOrEqual(4);
  });

  test('every asset a component asks for is on disk', () => {
    const missing = referenced
      .filter(({ resolved }) => !existsSync(resolved))
      .map(({ file, reference }) => `${file} requires ${reference}, which does not exist`);

    expect(missing).toEqual([]);
  });

  test('every asset and plugin app.json names is on disk', () => {
    const missing = appJsonReferenced
      .filter((reference) => {
        const resolved = join(RepoRoot, reference);
        // Config plugins resolve like modules: bare, .js, or a directory
        return !existsSync(resolved) && !existsSync(`${resolved}.js`);
      })
      .map((reference) => `app.json names ${reference}, which does not exist`);

    expect(missing).toEqual([]);
  });
});
