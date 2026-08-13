#!/usr/bin/env node
/**
 * Which components does the React Compiler actually compile?
 *
 * `experiments.reactCompiler` is on, and a bail is silent: no warning,
 * no lint failure, no build failure — the component simply stops being
 * memoized while the file beside it looks identical (AGENTS.md). The
 * only way to know is to run the real pipeline and read the compiler's
 * own log, which is what this does: `babel-preset-expo` with
 * `supportsReactCompiler`, the same caller Metro passes for a
 * production iOS bundle.
 *
 *   node scripts/react-compiler-scan.js          # human report
 *   node scripts/react-compiler-scan.js --json   # what the fence reads
 *
 * `src/__tests__/react-compiler-test.ts` runs this in a child process —
 * out of jest, because requiring babel-preset-expo through jest's
 * resolver turns a one-second scan into a minute.
 */
const { transformSync } = require('@babel/core');
const { parse } = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const { readdirSync, readFileSync } = require('fs');
const { join, relative } = require('path');

const traverse = traverseModule.default ?? traverseModule;
const RepoRoot = join(__dirname, '..');

/**
 * `src/widgets` is left out on purpose: babel-preset-expo opts widget
 * files out via the `widget` directive — they are stringified functions
 * that emit SwiftUI, not React that renders.
 */
const Dirs = ['src/components', 'src/app'];

function listFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') listFiles(full, out);
    } else if (entry.name.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/** The compiler reports a line; the reader needs a name. */
function componentAt(code, line) {
  const ast = parse(code, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  let name = `line ${line}`;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.loc?.start.line === line && path.node.id) name = path.node.id.name;
    },
    VariableDeclarator(path) {
      const init = path.node.init;
      if (!init || (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')) {
        return;
      }
      if (init.loc?.start.line === line && path.node.id.type === 'Identifier') {
        name = path.node.id.name;
      }
    },
  });
  return name;
}

function scan() {
  const files = [];
  for (const dir of Dirs) listFiles(join(RepoRoot, dir), files);
  files.sort();

  const compiled = {};
  const bails = [];

  for (const absolute of files) {
    const path = relative(RepoRoot, absolute).split('\\').join('/');
    const code = readFileSync(absolute, 'utf8');
    const events = [];

    transformSync(code, {
      filename: absolute,
      cwd: RepoRoot,
      root: RepoRoot,
      babelrc: false,
      configFile: false,
      presets: [
        [
          require.resolve('babel-preset-expo'),
          { 'react-compiler': { logger: { logEvent: (_f, event) => events.push(event) } } },
        ],
      ],
      // isDev:false is what makes the compiler log a bail rather than
      // throw on it — the production bundle's behaviour exactly.
      caller: {
        name: 'metro',
        bundler: 'metro',
        platform: 'ios',
        engine: 'hermes',
        isDev: false,
        supportsStaticESM: true,
        supportsReactCompiler: true,
      },
    });

    compiled[path] = [];
    const seen = new Set();
    for (const event of events) {
      if (event.kind === 'CompileSuccess') {
        if (event.fnName) compiled[path].push(event.fnName);
        continue;
      }
      if (event.kind !== 'CompileError' && event.kind !== 'CompileSkip') continue;

      const line = event.fnLoc?.start?.line ?? 0;
      const component = componentAt(code, line);
      if (seen.has(component)) continue; // one component, several complaints
      seen.add(component);
      const options = event.detail?.options ?? {};
      bails.push({
        file: path,
        component,
        line,
        category: options.category ?? event.kind,
        reason: options.reason ?? event.kind,
        description: options.description ?? '',
      });
    }
  }

  return { compiled, bails };
}

const result = scan();

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(result));
} else {
  const total = Object.values(result.compiled).reduce((sum, names) => sum + names.length, 0);
  console.log(`${total} components compiled, ${result.bails.length} bailed\n`);
  for (const bail of result.bails) {
    console.log(`${bail.file}:${bail.line}  ${bail.component}`);
    console.log(`  ${bail.category}: ${bail.reason}`);
    if (bail.description) console.log(`  ${bail.description}`);
    console.log('');
  }
}
