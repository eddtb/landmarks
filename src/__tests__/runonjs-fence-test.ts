/**
 * `runOnJS` is deprecated (Reanimated 4.3) and its replacement is
 * already in the house: `scheduleOnRN` from react-native-worklets,
 * which animated-icon.tsx adopted first. The migration is only done if
 * it STAYS done — a copy-pasted worklet resurrects the old spelling in
 * one paste, and nothing else would say so until the API is deleted in
 * some future major and the app stops building.
 *
 * Fenced across the class: every source file, not the four call sites
 * that were migrated.
 */
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const SrcRoot = join(__dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** The file, minus its comments — the migration notes at the old call
 * sites are allowed to name what they replaced. */
function codeOnly(file: string): string {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
    .join('\n');
}

test('nothing imports or calls the deprecated runOnJS', () => {
  const offenders = sourceFiles(SrcRoot)
    .filter((file) => /\brunOnJS\b/.test(codeOnly(file)))
    .map(
      (file) =>
        `${relative(join(SrcRoot, '..'), file)} spells runOnJS.\n` +
        `    RULE: runOnJS is deprecated in Reanimated 4.3.\n` +
        `    FIX:  import { scheduleOnRN } from 'react-native-worklets' and call\n` +
        `          scheduleOnRN(fn, ...args) — animated-icon.tsx shows the shape.`
    );

  expect(offenders).toEqual([]);
});

test('the fence is actually reading the tree', () => {
  // A scan that quietly lists nothing passes the test above unearned
  expect(sourceFiles(SrcRoot).length).toBeGreaterThan(50);
});
