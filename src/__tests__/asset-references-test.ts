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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

function referencesIn(file: string): string[] {
  return readFileSync(file, 'utf8').match(AssetReference) ?? [];
}

const files = sourceFiles(SourceRoot);
const referenced = files.flatMap((file) =>
  referencesIn(file).map((reference) => ({ file: file.slice(RepoRoot.length + 1), reference }))
);

describe('asset references', () => {
  // Without this, deleting every asset in the app would leave the suite
  // below green and silent — the failure mode this file exists to end.
  test('the scan is actually reading the tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(referenced.length).toBeGreaterThan(0);
  });

  test('every asset a component asks for is on disk', () => {
    const missing = referenced
      .filter(({ reference }) => !existsSync(join(RepoRoot, reference.replace('@/', ''))))
      .map(({ file, reference }) => `${file} requires ${reference}, which does not exist`);

    expect(missing).toEqual([]);
  });
});
