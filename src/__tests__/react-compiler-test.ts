/**
 * The React Compiler is on, and it bails in silence.
 *
 * `app.json`'s `experiments.reactCompiler` is true, so every component
 * is supposed to arrive memoized. When the compiler cannot compile one
 * it does not warn, does not fail lint and does not fail the build — it
 * leaves that component unoptimised while the file beside it looks
 * identical. Two things opt a component out, and neither looks like a
 * mistake at the site: a conditional inside a `try`/`catch` (which makes
 * it abandon the ENTIRE enclosing function), and a single
 * `eslint-disable-next-line react-hooks/*`.
 *
 * The only way to know is to ask the compiler, so this asks it:
 * `scripts/react-compiler-scan.js` runs the real pipeline —
 * `babel-preset-expo` with `supportsReactCompiler`, the caller Metro
 * passes for a production iOS bundle — and reports what compiled and
 * what did not, with the compiler's own reason.
 *
 * It runs in a CHILD PROCESS on purpose. Requiring babel-preset-expo
 * through jest's resolver turns a two-second scan into a minute.
 *
 * Expect this to go red when a branch lands a new bail. That is the
 * fence working. Fix the component; do not extend the list.
 */
import { QuarantinedCompilerBails } from '@/test-utils/design-allowlist';
import { RepoRoot } from '@/test-utils/design-scan';
import { execFileSync } from 'child_process';
import { join } from 'path';

type Bail = {
  file: string;
  component: string;
  line: number;
  category: string;
  reason: string;
  description: string;
};

const scan = (): { compiled: Record<string, string[]>; bails: Bail[] } =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [join(RepoRoot, 'scripts', 'react-compiler-scan.js'), '--json'],
      { cwd: RepoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    )
  );

/**
 * Load-bearing components that must arrive memoized. Every one of these
 * re-renders on a scroll, a GPS tick or a stream chunk — where an
 * unmemoized derivation costs frames rather than microseconds.
 */
const MustCompile: readonly { file: string; component: string }[] = [
  { file: 'src/components/history-card.tsx', component: 'HistoryCard' },
  { file: 'src/components/section-screen.tsx', component: 'StoriesScreen' },
  { file: 'src/components/section-screen.tsx', component: 'HistoryArchiveScreen' },
  { file: 'src/components/section-screen.tsx', component: 'FeaturedRail' },
  { file: 'src/components/telling-section.tsx', component: 'TellingSection' },
  { file: 'src/components/pointer-dial.tsx', component: 'PointerDial' },
  { file: 'src/components/glass-header.tsx', component: 'GlassIslandHeader' },
  { file: 'src/components/area-gazetteer.tsx', component: 'Hero' },
  { file: 'src/components/quiz-run.tsx', component: 'QuizRun' },
  { file: 'src/app/history/[pageId]/index.tsx', component: 'HistoryDetailScreen' },
];

describe('the React Compiler compiles what it is given', () => {
  const { compiled, bails } = scan();

  test('the scan actually ran the compiler', () => {
    const total = Object.values(compiled).reduce((sum, names) => sum + names.length, 0);
    expect(total).toBeGreaterThan(50);
  });

  test('every load-bearing component compiles', () => {
    const missing = MustCompile.filter(
      (entry) => !(compiled[entry.file] ?? []).includes(entry.component)
    );

    expect(
      missing.map(
        (entry) =>
          `${entry.file}  ${entry.component} is no longer compiled by the React Compiler.\n` +
          `    RULE: experiments.reactCompiler is on, and a bail is SILENT — no warning, no lint\n` +
          `          failure, no build failure, just a component that stopped being memoized.\n` +
          `    FIX:  the two usual causes are a conditional (ternary, &&, ?.) inside a try/catch —\n` +
          `          extract it into a module-level helper, hoisting it out of the try does not\n` +
          `          help — and an \`eslint-disable-next-line react-hooks/*\`, which de-optimises\n` +
          `          the whole component it sits in.\n` +
          `    SEE:  node scripts/react-compiler-scan.js — it prints the compiler's own reason.`
      )
    ).toEqual([]);
  });

  test('no component has quietly stopped compiling', () => {
    const surprises = bails.filter(
      (bail) =>
        !QuarantinedCompilerBails.some(
          (entry) => entry.file === bail.file && entry.component === bail.component
        )
    );

    expect(
      surprises.map(
        (bail) =>
          `${bail.file}:${bail.line}  ${bail.component} stopped compiling.\n` +
          `    COMPILER (${bail.category}): ${bail.reason}\n` +
          (bail.description ? `    ${bail.description}\n` : '') +
          `    FIX: repair the component. Adding it to QuarantinedCompilerBails is not a fix —\n` +
          `         that list is scheduled debt from #299 and may only shrink.`
      )
    ).toEqual([]);
  });

  test('a repaired component leaves the quarantine list', () => {
    // The other direction of the ratchet: fix one and this fails, which
    // is how the list can only ever shrink.
    const stale = QuarantinedCompilerBails.filter(
      (entry) =>
        !bails.some((bail) => bail.file === entry.file && bail.component === entry.component)
    );

    expect(
      stale.map(
        (entry) =>
          `${entry.file}  ${entry.component} compiles now.\n` +
          `    FIX: delete its entry from QuarantinedCompilerBails in\n` +
          `         src/test-utils/design-allowlist.ts, in the same commit as the repair.`
      )
    ).toEqual([]);
  });

  test('each quarantined bail still fails for the reason it was filed under', () => {
    // A component that starts failing for a NEW reason is a new bug
    // wearing an old entry's coat.
    for (const entry of QuarantinedCompilerBails) {
      const bail = bails.find(
        (found) => found.file === entry.file && found.component === entry.component
      );
      expect(`${entry.component}: ${bail?.category}`).toBe(`${entry.component}: ${entry.category}`);
    }
  });
});
